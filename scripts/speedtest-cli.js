#!/usr/bin/env node

import { performance } from 'perf_hooks';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const BASE_URL = process.argv[2] || process.env.BASE_URL || 'http://localhost:4321';

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const MUTE = '\x1b[90m';

// Configuration matching the web UI
const CONFIG = {
  PING_ITERATIONS: 15,
  PING_INTERVAL_MS: 80,
  DOWNLOAD_WARMUP_MS: 1500,
  DOWNLOAD_RAMP_MS: 2500,
  DOWNLOAD_MEASURE_MS: 10000,
  DOWNLOAD_PEAK_MS: 3000,
  CHUNK_WARMUP: 100 * 1024,
  CHUNK_RAMP: 1 * 1024 * 1024,
  CHUNK_MEASURE: 10 * 1024 * 1024,
  CHUNK_PEAK: 25 * 1024 * 1024,
  UPLOAD_WARMUP_MS: 1500,
  UPLOAD_RAMP_MS: 2500,
  UPLOAD_MEASURE_MS: 10000,
  UPLOAD_PEAK_MS: 3000,
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 2 * 1024 * 1024,
  PARALLEL_STREAMS: 1,
  PACKET_LOSS_PINGS: 50,
  PACKET_LOSS_INTERVAL_MS: 150,
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function calculateTrimmedMean(arr, trimPercent = 0.1) {
  if (arr.length === 0) return 0;
  if (arr.length <= 10) {
    // Use median for small samples (more robust)
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.max(1, Math.floor(sorted.length * trimPercent));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) return arr.reduce((a, b) => a + b, 0) / arr.length;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

function calculateJitter(arr) {
  if (arr.length <= 1) return 0;
  let sumSquaredDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (arr.length - 1));
}

function formatMbps(bps) {
  const mbps = bps / 1000000;
  return mbps.toFixed(1);
}

async function main() {
  console.log(`${BOLD}${CYAN}Welcome to Net-Speed CLI v${version}${RESET}`);
  console.log(`${MUTE}Connecting to speedtest server at ${BASE_URL}...${RESET}`);

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
    
    // Detect IPv4 vs IPv6
    const ipVersion = clientInfo.ip.includes(':') ? 'IPv6' : 'IPv4';
    console.log(`   Network: ${GREEN}${ipVersion}${RESET}`);
  } catch (err) {
    console.log(`   ${YELLOW}IP/Geolocation detection failed. Using defaults.${RESET}`);
    clientInfo = { latitude: 0, longitude: 0, ip: '127.0.0.1', org: 'Local Loopback' };
  }

  // 3. Selecting Optimal Server
  console.log(`\n${BOLD}2. Selecting optimal server...${RESET}`);
  const SERVER_LIST = [
    { id: "india-mumbai", name: "Mumbai, India", lat: 19.0760, lon: 72.8777, region: "ap-south" },
    { id: "india-bangalore", name: "Bangalore, India", lat: 12.9716, lon: 77.5946, region: "ap-south" },
    { id: "singapore", name: "Singapore", lat: 1.3521, lon: 103.8198, region: "ap-southeast" },
    { id: "tokyo", name: "Tokyo, Japan", lat: 35.6762, lon: 139.6503, region: "ap-northeast" },
    { id: "seoul", name: "Seoul, South Korea", lat: 37.6565, lon: 126.9780, region: "ap-northeast" },
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

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const clat = clientInfo.latitude || 0;
  const clon = clientInfo.longitude || 0;
  const servers = SERVER_LIST.map(s => {
    const d = (clat !== 0 && clon !== 0) ? haversine(clat, clon, s.lat, s.lon) : 9999;
    return { ...s, distance: Math.round(d) };
  }).sort((a, b) => a.distance - b.distance);

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
    console.error(`${RED}[ERROR] No servers responded!${RESET}`);
    process.exit(1);
  }

  probeResults.sort((a, b) => a.latency - b.latency);
  const best = probeResults[0].server;
  const bestLatency = probeResults[0].latency;
  console.log(`   ${GREEN}[OK] Selected optimal server: ${best.name} (Latency: ${bestLatency.toFixed(1)}ms)${RESET}`);

  // 4. Run Ping iterations (with trimmed mean)
  console.log(`\n${BOLD}3. Pinging selected server (${CONFIG.PING_ITERATIONS} iterations)...${RESET}`);
  const latencies = [];
  let lost = 0;

  // Warmup connection
  try {
    await fetch(`${BASE_URL}/api/ping?warmup=true&cb=warmup-${Date.now()}`);
  } catch (_) {}

  for (let i = 0; i < CONFIG.PING_ITERATIONS; i++) {
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
    await sleep(CONFIG.PING_INTERVAL_MS);
  }

  if (latencies.length === 0) {
    console.error(`${RED}[ERROR] Ping phase failed completely.${RESET}`);
    process.exit(1);
  }

  // Use trimmed mean for latency — eliminates outliers from GC pauses etc.
  const avgPing = calculateTrimmedMean(latencies);
  const minPing = Math.min(...latencies);
  const maxPing = Math.max(...latencies);
  const jitter = calculateJitter(latencies);

  console.log(`\n   --- Ping Statistics ---`);
  console.log(`   Packets: Sent = ${CONFIG.PING_ITERATIONS}, Received = ${latencies.length}, Lost = ${lost} (${((lost / CONFIG.PING_ITERATIONS) * 100).toFixed(1)}% loss)`);
  console.log(`   RTT:     Min = ${minPing.toFixed(1)}ms, Avg = ${avgPing.toFixed(1)}ms, Max = ${maxPing.toFixed(1)}ms, Jitter = ${jitter.toFixed(1)}ms`);

  // 5. Multi-phase Download Test (matching web UI protocol)
  console.log(`\n${BOLD}4. Measuring download speed (multi-phase)...${RESET}`);

  const phases = [
    { name: "warmup", size: CONFIG.CHUNK_WARMUP, duration: CONFIG.DOWNLOAD_WARMUP_MS },
    { name: "ramp", size: CONFIG.CHUNK_RAMP, duration: CONFIG.DOWNLOAD_RAMP_MS },
    { name: "measure", size: CONFIG.CHUNK_MEASURE, duration: CONFIG.DOWNLOAD_MEASURE_MS },
    { name: "peak", size: CONFIG.CHUNK_PEAK, duration: CONFIG.DOWNLOAD_PEAK_MS },
  ];

  let totalDlBytes = 0;
  let measurementBytes = 0;
  let measurementStartTime = null;
  const allInstantaneousSpeeds = [];

  for (const phase of phases) {
    process.stdout.write(`   Phase: ${phase.name} (${(phase.size / 1024).toFixed(0)}KB chunks)...`);

    const phaseStart = performance.now();
    let phaseBytes = 0;

    // Capture baseline BEFORE measurement phase starts
    if (phase.name === "measure") {
      measurementStartTime = performance.now();
      measurementBytes = totalDlBytes;
      measurementPhaseActive = true;
    }

    while (performance.now() - phaseStart < phase.duration) {
      const start = performance.now();
      try {
        const url = `https://speed.cloudflare.com/__down?bytes=${phase.size}&region=${best.region}&serverId=${best.id}&cb=${Date.now()}-${Math.random()}`;
        const res = await fetch(url, {
          headers: { "Cache-Control": "no-store, no-cache" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            phaseBytes += value.length;
            totalDlBytes += value.length;
          }
        }
        reader.cancel().catch(() => {});

        // Track instantaneous speed using cumulative phase bytes
        const elapsed = (performance.now() - start) / 1000;
        if (elapsed > 0.05) {
          const instBps = (phaseBytes * 8) / elapsed;
          allInstantaneousSpeeds.push(instBps);
        }
      } catch (_) {
        // Skip failed chunks
      }
      await sleep(0); // yield to event loop
    }

    const phaseMbps = phaseBytes > 0 && phase.duration > 0
      ? formatMbps((phaseBytes * 8) / (phase.duration / 1000))
      : "0.0";
    console.log(` ${GREEN}${phaseMbps} Mbps${RESET} (${(phaseBytes / (1024 * 1024)).toFixed(1)} MB)`);
  }

  // Calculate final average from measurement phase
  let finalDlMbps = 0;
  if (measurementStartTime) {
    const elapsedSec = (performance.now() - measurementStartTime) / 1000;
    const bytesTransferred = totalDlBytes - measurementBytes;
    finalDlMbps = elapsedSec > 0.1 ? (bytesTransferred * 8) / elapsedSec / 1000000 : 0;
  }

  // Calculate peak as 95th percentile
  let dlPeak = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    dlPeak = sorted[Math.min(p95Index, sorted.length - 1)] / 1000000;
  }

  console.log(`   Download: ${BOLD}${GREEN}${finalDlMbps.toFixed(1)} Mbps${RESET} [Peak: ${dlPeak.toFixed(1)} Mbps] (Total: ${(totalDlBytes / (1024 * 1024)).toFixed(1)} MB)`);

  // 6. Multi-phase Upload Test (matching web UI protocol)
  console.log(`\n${BOLD}5. Measuring upload speed (multi-phase)...${RESET}`);

  const uploadPhases = [
    { name: "warmup", size: 100 * 1024, duration: CONFIG.UPLOAD_WARMUP_MS },
    { name: "ramp", size: 1 * 1024 * 1024, duration: CONFIG.UPLOAD_RAMP_MS },
    { name: "measure", size: 10 * 1024 * 1024, duration: CONFIG.UPLOAD_MEASURE_MS },
    { name: "peak", size: 25 * 1024 * 1024, duration: CONFIG.UPLOAD_PEAK_MS },
  ];

  let totalUlBytes = 0;
  let ulMeasurementBytes = 0;
  let ulMeasurementStartTime = null;
  const allUlInstantaneousSpeeds = [];

  for (const phase of uploadPhases) {
    process.stdout.write(`   Phase: ${phase.name} (${(phase.size / 1024).toFixed(0)}KB chunks)...`);

    const phaseStart = performance.now();
    let phaseBytes = 0;
    let nextChunkSize = CONFIG.UPLOAD_MIN_CHUNK;

    // Capture baseline BEFORE measurement phase starts
    if (phase.name === "measure") {
      ulMeasurementStartTime = performance.now();
      ulMeasurementBytes = totalUlBytes;
    }

    while (performance.now() - phaseStart < phase.duration) {
      const chunkSize = Math.min(nextChunkSize, phase.size);
      const uploadData = crypto.randomBytes(chunkSize);

      const start = performance.now();
      try {
        const url = `https://speed.cloudflare.com/__up?bytes=${chunkSize}&region=${best.region}&serverId=${best.id}&cb=${Date.now()}-${Math.random()}`;
        const res = await fetch(url, {
          method: 'POST',
          body: uploadData,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store, no-cache',
          }
        });

        if (res.ok) {
          const result = await res.json();
          const verifiedBytes = result.bytesReceived || chunkSize;
          phaseBytes += verifiedBytes;
          totalUlBytes += verifiedBytes;

          // Dynamic chunk sizing
          const elapsed = (performance.now() - start) / 1000;
          if (elapsed > 0) {
            const chunkBps = (verifiedBytes * 8) / elapsed;
            nextChunkSize = Math.floor((chunkBps * 0.3) / 8);
            nextChunkSize = Math.max(CONFIG.UPLOAD_MIN_CHUNK, Math.min(nextChunkSize, CONFIG.UPLOAD_MAX_CHUNK));
          }

          // Track instantaneous speed using cumulative phase bytes
          if (elapsed > 0.05) {
            const instBps = (phaseBytes * 8) / elapsed;
            allUlInstantaneousSpeeds.push(instBps);
          }
        }
      } catch (_) {
        // Skip failed chunks
      }
      await sleep(30); // brief pause between uploads
    }

    const phaseMbps = phaseBytes > 0 && phase.duration > 0
      ? formatMbps((phaseBytes * 8) / (phase.duration / 1000))
      : "0.0";
    console.log(` ${GREEN}${phaseMbps} Mbps${RESET} (${(phaseBytes / (1024 * 1024)).toFixed(1)} MB)`);
  }

  // Calculate final average from measurement phase
  let finalUlMbps = 0;
  if (ulMeasurementStartTime) {
    const elapsedSec = (performance.now() - ulMeasurementStartTime) / 1000;
    const bytesTransferred = totalUlBytes - ulMeasurementBytes;
    finalUlMbps = elapsedSec > 0.1 ? (bytesTransferred * 8) / elapsedSec / 1000000 : 0;
  }

  // Calculate peak as 95th percentile
  let ulPeak = 0;
  if (allUlInstantaneousSpeeds.length > 0) {
    const sorted = [...allUlInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    ulPeak = sorted[Math.min(p95Index, sorted.length - 1)] / 1000000;
  }

  console.log(`   Upload:   ${BOLD}${GREEN}${finalUlMbps.toFixed(1)} Mbps${RESET} [Peak: ${ulPeak.toFixed(1)} Mbps] (Total: ${(totalUlBytes / (1024 * 1024)).toFixed(1)} MB)`);

  // 7. Packet Loss Test
  console.log(`\n${BOLD}6. Measuring packet loss (${CONFIG.PACKET_LOSS_PINGS} pings)...${RESET}`);
  let plSent = 0;
  let plLost = 0;

  for (let i = 0; i < CONFIG.PACKET_LOSS_PINGS; i++) {
    plSent++;
    try {
      const url = `${BASE_URL}/api/ping?region=${best.region}&serverId=${best.id}&clientLat=${clat}&clientLon=${clon}&cb=pl-${Date.now()}-${i}`;
      const res = await fetch(url);
      if (!res.ok) {
        plLost++;
      } else {
        await res.text();
      }
    } catch (_) {
      plLost++;
    }
    if (i < CONFIG.PACKET_LOSS_PINGS - 1) {
      await sleep(CONFIG.PACKET_LOSS_INTERVAL_MS);
    }
  }

  const lossPercent = plSent > 0 ? (plLost / plSent) * 100 : 0;

  // 8. Final Output Dashboard Report
  console.log(`\n${BOLD}==================================================${RESET}`);
  console.log(`${BOLD}${GREEN}               SPEEDTEST CLI SUMMARY${RESET}`);
  console.log(`${BOLD}==================================================${RESET}`);
  console.log(`  Target Server:     ${best.name} (${best.region})`);
  console.log(`  Unloaded Ping:     ${GREEN}${avgPing.toFixed(1)} ms${RESET} (trimmed mean)`);
  console.log(`  Jitter:            ${GREEN}${jitter.toFixed(1)} ms${RESET}`);
  console.log(`  Packet Loss:       ${lossPercent > 0 ? RED : GREEN}${lossPercent.toFixed(1)} %${RESET} (HTTP-level, TCP retransmits masked)`);
  console.log(`  Download Speed:    ${BOLD}${CYAN}${finalDlMbps.toFixed(1)} Mbps${RESET} (Peak: ${dlPeak.toFixed(1)} Mbps)`);
  console.log(`  Upload Speed:      ${BOLD}${CYAN}${finalUlMbps.toFixed(1)} Mbps${RESET} (Peak: ${ulPeak.toFixed(1)} Mbps)`);
  console.log(`${BOLD}==================================================${RESET}\n`);
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
