#!/usr/bin/env node

import { performance } from 'perf_hooks';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:4321';

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const MUTE = '\x1b[90m';

async function main() {
  console.log(`${BOLD}${CYAN}Welcome to Net-Speed CLI v0.1.1${RESET}`);
  console.log(`${MUTE}Checking local speedtest server at ${BASE_URL}...${RESET}`);

  // 1. Verify server is running
  try {
    const res = await fetch(`${BASE_URL}/api/ping?warmup=true`);
    if (!res.ok) throw new Error();
  } catch (err) {
    console.error(`\n${RED}[ERROR] Local speedtest server is not running!${RESET}`);
    console.error(`Please run ${BOLD}npm run dev${RESET} in another terminal window first.\n`);
    process.exit(1);
  }

  // 2. Fetch Client Geo Info
  console.log(`\n${BOLD}1. Detecting client geolocation...${RESET}`);
  let clientInfo = null;
  try {
    const res = await fetch(`${BASE_URL}/api/ip-geo`);
    clientInfo = await res.json();
    console.log(`   IP:      ${GREEN}${clientInfo.ip}${RESET} (${clientInfo.org || 'Unknown ISP'})`);
    console.log(`   Loc:     ${GREEN}${clientInfo.city}, ${clientInfo.region}, ${clientInfo.country}${RESET}`);
  } catch (err) {
    console.log(`   ${YELLOW}IP/Geolocation detection failed. Using defaults.${RESET}`);
    clientInfo = { latitude: 0, longitude: 0, ip: '127.0.0.1', org: 'Local Loopback' };
  }

  // 3. Probing Closest Edge Server
  console.log(`\n${BOLD}2. Selecting optimal edge server...${RESET}`);
  const SERVER_LIST = [
    { id: "india-mumbai", name: "Mumbai, India", lat: 19.0760, lon: 72.8777, region: "ap-south" },
    { id: "india-bangalore", name: "Bangalore, India", lat: 12.9716, lon: 77.5946, region: "ap-south" },
    { id: "singapore", name: "Singapore", lat: 1.3521, lon: 103.8198, region: "ap-southeast" },
    { id: "tokyo", name: "Tokyo, Japan", lat: 35.6762, lon: 139.6503, region: "ap-northeast" },
    { id: "seoul", name: "Seoul, South Korea", lat: 37.5665, lon: 126.9780, region: "ap-northeast" },
    { id: "sydney", name: "Sydney, Australia", lat: -33.8688, lon: 151.2093, region: "ap-southeast" },
    { id: "frankfurt", name: "Frankfurt, Germany", lat: 50.1109, lon: 8.6821, region: "eu-central" },
    { id: "london", name: "London, United Kingdom", lat: 51.5072, lon: -0.1276, region: "eu-west" },
    { id: "paris", name: "Paris, France", lat: 48.8566, lon: 2.3522, region: "eu-west" },
    { id: "new-york", name: "New York, United States", lat: 40.7128, lon: -74.0060, region: "us-east" },
    { id: "los-angeles", name: "Los Angeles, United States", lat: 34.0522, lon: -118.2437, region: "us-west" },
    { id: "toronto", name: "Toronto, Canada", lat: 43.6532, lon: -79.3832, region: "ca-central" },
    { id: "sao-paulo", name: "São Paulo, Brazil", lat: -23.5505, lon: -46.6333, region: "sa-east" },
    { id: "johannesburg", name: "Johannesburg, South Africa", lat: -26.2041, lon: 28.0473, region: "af-south" },
    { id: "dubai", name: "Dubai, United Arab Emirates", lat: 25.2048, lon: 55.2708, region: "me-central" }
  ];

  // Haversine Distance helper
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const clat = clientInfo.latitude || 0;
  const clon = clientInfo.longitude || 0;
  const servers = SERVER_LIST.map(s => {
    const d = (clat !== 0 && clon !== 0) ? haversine(clat, clon, s.lat, s.lon) : 9999;
    return { ...s, distance: Math.round(d) };
  }).sort((a, b) => a.distance - b.distance);

  // Probe top 5 closest
  const candidates = servers.slice(0, 5);
  console.log(`   Probing candidate server latencies:`);

  const probeResults = [];
  for (const s of candidates) {
    const start = performance.now();
    try {
      const url = `${BASE_URL}/api/ping?region=${s.region}&serverId=${s.id}&clientLat=${clat}&clientLon=${clon}&cb=${Date.now()}`;
      const res = await fetch(url);
      if (res.ok) {
        await res.text();
        const latency = performance.now() - start;
        console.log(`     - ${s.name}: ${GREEN}${latency.toFixed(1)} ms${RESET}`);
        probeResults.push({ server: s, latency });
      }
    } catch (_) {
      console.log(`     - ${s.name}: ${RED}FAILED${RESET}`);
    }
  }

  if (probeResults.length === 0) {
    console.error(`${RED}[ERROR] No edge servers responded!${RESET}`);
    process.exit(1);
  }

  probeResults.sort((a, b) => a.latency - b.latency);
  const best = probeResults[0].server;
  const bestLatency = probeResults[0].latency;
  console.log(`   ${GREEN}[OK] Selected optimal edge: ${best.name} (Latency: ${bestLatency.toFixed(1)}ms)${RESET}`);

  // 4. Run Ping iterations
  console.log(`\n${BOLD}3. Pinging selected server (15 iterations)...${RESET}`);
  const latencies = [];
  let lost = 0;
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    try {
      const url = `${BASE_URL}/api/ping?region=${best.region}&serverId=${best.id}&clientLat=${clat}&clientLon=${clon}&cb=${Date.now()}-${i}`;
      const res = await fetch(url);
      if (res.ok) {
        await res.text();
        const latency = performance.now() - start;
        latencies.push(latency);
        process.stdout.write(`   seq=${i + 1} time=${latency.toFixed(1)} ms\n`);
      } else {
        lost++;
        process.stdout.write(`   seq=${i + 1} ${RED}LOST${RESET}\n`);
      }
    } catch (_) {
      lost++;
      process.stdout.write(`   seq=${i + 1} ${RED}ERROR${RESET}\n`);
    }
    await new Promise(r => setTimeout(r, 60));
  }

  // Calculate statistics
  if (latencies.length === 0) {
    console.error(`${RED}[ERROR] Ping phase failed completely.${RESET}`);
    process.exit(1);
  }

  const avgPing = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minPing = Math.min(...latencies);
  const maxPing = Math.max(...latencies);

  let jitterSum = 0;
  for (let i = 1; i < latencies.length; i++) {
    jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
  }
  const jitter = latencies.length > 1 ? jitterSum / (latencies.length - 1) : 0;

  console.log(`\n   --- Ping Statistics ---`);
  console.log(`   Packets: Sent = 15, Received = ${latencies.length}, Lost = ${lost} (${((lost / 15) * 100).toFixed(1)}% loss)`);
  console.log(`   RTT:     Min = ${minPing.toFixed(1)}ms, Avg = ${avgPing.toFixed(1)}ms, Max = ${maxPing.toFixed(1)}ms, Jitter = ${jitter.toFixed(1)}ms`);

  // 5. Run Download test
  console.log(`\n${BOLD}4. Measuring download speed (10MB)...${RESET}`);
  const dlSize = 10 * 1024 * 1024; // 10MB
  const dlUrl = `${BASE_URL}/api/download?size=${dlSize}&region=${best.region}&serverId=${best.id}&clientLat=${clat}&clientLon=${clon}&basePing=${avgPing}&cb=${Date.now()}`;

  const dlStart = performance.now();
  let dlBytes = 0;
  let dlFirstByteTime = null;

  try {
    const res = await fetch(dlUrl);
    if (!res.body) throw new Error('No body in response');
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (dlFirstByteTime === null) dlFirstByteTime = performance.now();
        dlBytes += value.length;
        const elapsed = (performance.now() - dlFirstByteTime) / 1000;
        if (elapsed > 0.05) {
          const bps = (dlBytes * 8) / elapsed;
          const mbps = bps / 1000000;
          const pct = Math.min(100, Math.round((dlBytes / dlSize) * 100));
          const barLen = Math.floor(pct / 5);
          const bar = '█'.repeat(barLen) + ' '.repeat(20 - barLen);
          process.stdout.write(`\r   Download: ${mbps.toFixed(1)} Mbps [${bar}] ${pct}%`);
        }
      }
    }
  } catch (err) {
    console.error(`\n   ${RED}Download failed: ${err.message}${RESET}`);
  }

  const dlDuration = (performance.now() - (dlFirstByteTime || dlStart)) / 1000;
  const finalDlMbps = dlDuration > 0.1 ? ((dlBytes * 8) / dlDuration) / 1000000 : 0;
  console.log(`\r   Download: ${GREEN}${finalDlMbps.toFixed(1)} Mbps${RESET} [████████████████████] 100% (Total: ${(dlBytes / (1024 * 1024)).toFixed(1)} MB in ${dlDuration.toFixed(1)}s)`);

  // 6. Run Upload test
  console.log(`\n${BOLD}5. Measuring upload speed (5MB)...${RESET}`);
  const ulSize = 5 * 1024 * 1024; // 5MB
  const ulData = crypto.randomBytes(ulSize);

  const ulUrl = `${BASE_URL}/api/upload?region=${best.region}&serverId=${best.id}&clientLat=${clat}&clientLon=${clon}&basePing=${avgPing}&cb=${Date.now()}`;

  const ulStart = performance.now();
  let finalUlMbps = 0;
  let ulDuration = 0;
  try {
    const res = await fetch(ulUrl, {
      method: 'POST',
      body: ulData,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache',
      }
    });

    if (res.ok) {
      ulDuration = (performance.now() - ulStart) / 1000;
      finalUlMbps = ulDuration > 0.1 ? ((ulSize * 8) / ulDuration) / 1000000 : 0;
      console.log(`   Upload:   ${GREEN}${finalUlMbps.toFixed(1)} Mbps${RESET} [████████████████████] 100% (Total: ${(ulSize / (1024 * 1024)).toFixed(1)} MB in ${ulDuration.toFixed(1)}s)`);
    } else {
      throw new Error(`Status ${res.status}`);
    }
  } catch (err) {
    console.error(`   ${RED}Upload failed: ${err.message}${RESET}`);
  }

  // 7. Final Output Dashboard Report
  console.log(`\n${BOLD}==================================================${RESET}`);
  console.log(`${BOLD}${GREEN}               SPEEDTEST CLI SUMMARY${RESET}`);
  console.log(`${BOLD}==================================================${RESET}`);
  console.log(`  Target Edge Node:  ${best.name} (${best.region})`);
  console.log(`  Unloaded Ping:     ${GREEN}${avgPing.toFixed(1)} ms${RESET}`);
  console.log(`  Jitter:            ${GREEN}${jitter.toFixed(1)} ms${RESET}`);
  console.log(`  Packet Loss:       ${lost > 0 ? RED : GREEN}${((lost / 15) * 100).toFixed(1)} %${RESET}`);
  console.log(`  Download Speed:    ${BOLD}${CYAN}${finalDlMbps.toFixed(1)} Mbps${RESET}`);
  console.log(`  Upload Speed:      ${BOLD}${CYAN}${finalUlMbps.toFixed(1)} Mbps${RESET}`);
  console.log(`${BOLD}==================================================${RESET}\n`);
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
