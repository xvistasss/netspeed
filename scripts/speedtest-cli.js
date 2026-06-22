#!/usr/bin/env node

/**
 * Net-Speed CLI — matches web worker architecture exactly.
 *
 * Measurement methodology (identical to web):
 *   1. Ping: 35 HTTP pings to speed.cloudflare.com/__down?bytes=1
 *   2. Download: 6 parallel streaming connections, 4-phase (warmup/ramp/measure/peak)
 *   3. Upload: Parallel adaptive-chunk uploads, 4-phase
 *   4. Packet Loss: 100 HTTP pings to speed.cloudflare.com/__down?bytes=1
 *
 * All phases use identical timing, BDP calculations, and statistical
 * methods as the web worker. Results are directly comparable.
 */

import { performance } from 'perf_hooks';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// ─── Configuration (matching speedTestConfig.ts exactly) ───
const CONFIG = {
  CLOUDFLARE_SPEED_ENDPOINT: "https://speed.cloudflare.com",

  // Ping
  PING_ITERATIONS: 35,
  PING_INTERVAL_MS: 80,

  // Download phases (sequential durations)
  DOWNLOAD_WARMUP_MS: 1_500,
  DOWNLOAD_RAMP_MS: 2_500,
  DOWNLOAD_MEASURE_MS: 10_000,
  DOWNLOAD_PEAK_MS: 3_000,

  // Upload phases
  UPLOAD_WARMUP_MS: 1_500,
  UPLOAD_RAMP_MS: 2_500,
  UPLOAD_MEASURE_MS: 10_000,
  UPLOAD_PEAK_MS: 3_000,

  // Upload chunk sizing
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 2 * 1024 * 1024,
  UPLOAD_FETCH_TIMEOUT_MS: 30_000,

  // Parallelism
  PARALLEL_STREAMS: 6,

  // Packet loss
  PACKET_LOSS_PINGS: 100,
  PACKET_LOSS_INTERVAL_MS: 150,

  // Dynamic warmup (BDP)
  DYNAMIC_WARMUP_MIN_MS: 1_500,
  DYNAMIC_WARMUP_MAX_MS: 8_000,
  DYNAMIC_RAMP_MIN_MS: 2_500,
  DYNAMIC_RAMP_MAX_MS: 8_000,
};

// ─── ANSI colors ───
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const MUTE = '\x1b[90m';

// ─── Helpers ───
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function calculateTrimmedMean(arr, trimPercent = 0.1) {
  if (arr.length === 0) return 0;
  if (arr.length <= 10) {
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

function calculateMAD(arr) {
  if (arr.length === 0) return 0;
  const median = calculateTrimmedMean(arr, 0);
  const deviations = arr.map(val => Math.abs(val - median));
  return calculateTrimmedMean(deviations, 0);
}

function calculateFilteredJitter(arr, sigmaThreshold = 2) {
  if (arr.length <= 2) return calculateJitter(arr);
  const mad = calculateMAD(arr);
  if (mad === 0) return calculateJitter(arr);
  const median = calculateTrimmedMean(arr, 0);
  const filtered = arr.filter(val => Math.abs(val - median) <= sigmaThreshold * mad * 1.4826);
  if (filtered.length < 3) return calculateJitter(arr);
  return calculateJitter(filtered);
}

function calculateMin(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((min, val) => (val < min ? val : min), arr[0]);
}

function calculateMax(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((max, val) => (val > max ? val : max), arr[0]);
}

// Generate non-compressible random text — matches web worker
const RANDOM_BLOCK_SIZE = 65536;
let randomBlockCache = null;
function getRandomBlock() {
  if (randomBlockCache && randomBlockCache.length === RANDOM_BLOCK_SIZE) return randomBlockCache;
  const chars = new Array(RANDOM_BLOCK_SIZE);
  for (let i = 0; i < RANDOM_BLOCK_SIZE; i++) {
    chars[i] = String.fromCharCode(33 + (Math.random() * 94 | 0));
  }
  randomBlockCache = chars.join("");
  return randomBlockCache;
}
function generateRandomText(size) {
  const block = getRandomBlock();
  if (size <= RANDOM_BLOCK_SIZE) return block.slice(0, size);
  const fullBlocks = (size / RANDOM_BLOCK_SIZE) | 0;
  const remainder = size - fullBlocks * RANDOM_BLOCK_SIZE;
  let result = block.repeat(fullBlocks);
  if (remainder > 0) result += block.slice(0, remainder);
  return result;
}

function buildLatencyUrl(cacheBuster) {
  const cb = cacheBuster || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=${cb}`;
}

// ─── Main ───
async function main() {
  console.log(`${BOLD}${CYAN}Welcome to Net-Speed CLI v${version}${RESET}`);
  console.log(`${MUTE}Direct measurement against speed.cloudflare.com${RESET}\n`);

  // ─── 1. Client IP Detection ───
  console.log(`${BOLD}1. Detecting client information...${RESET}`);
  let clientInfo = { ip: "Unknown", org: "Unknown", city: "Unknown", region: "Unknown", country: "Unknown" };
  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      clientInfo.ip = data.ip || "Unknown";
      const ipVersion = clientInfo.ip.includes(':') ? 'IPv6' : 'IPv4';
      console.log(`   IP:      ${GREEN}${clientInfo.ip}${RESET} (${ipVersion})`);
    }
  } catch (_) {
    console.log(`   ${YELLOW}IP detection failed${RESET}`);
  }

  // ─── 2. Warmup Connection ───
  console.log(`\n${BOLD}2. Warming up connection to Cloudflare...${RESET}`);
  const warmupStart = performance.now();
  try {
    const res = await fetch(buildLatencyUrl(`warmup-${Date.now()}`), { cache: "no-store" });
    if (res.status !== 204) await res.text();
    const warmupMs = performance.now() - warmupStart;
    console.log(`   ${GREEN}[OK]${RESET} Connection established (${warmupMs.toFixed(1)}ms)`);
  } catch (_) {
    console.log(`   ${YELLOW}Warmup failed — proceeding anyway${RESET}`);
  }

  // ─── 3. Ping Test (35 iterations, same as web) ───
  console.log(`\n${BOLD}3. Pinging speed.cloudflare.com (${CONFIG.PING_ITERATIONS} iterations)...${RESET}`);

  // Connection warmup — 4 rapid requests (same as web worker)
  for (let w = 0; w < 4; w++) {
    try {
      const res = await fetch(buildLatencyUrl(`warmup-${w}-${Date.now()}`), { cache: "no-store" });
      if (res.status !== 204) await res.text();
    } catch (_) {}
  }

  const latencies = [];
  let pingSent = 0;
  let pingLost = 0;

  for (let i = 0; i < CONFIG.PING_ITERATIONS; i++) {
    pingSent++;
    let measurementCompleted = false;

    for (let retry = 0; retry < 2 && !measurementCompleted; retry++) {
      const start = performance.now();
      try {
        const suffix = `ping-${i}${retry > 0 ? `-retry${retry}` : ""}-${Date.now()}`;
        const res = await fetch(buildLatencyUrl(suffix), { cache: "no-store" });
        if (!res.ok) throw new Error("Ping failed");
        if (res.status !== 204) await res.text();
        const latency = performance.now() - start;
        latencies.push(latency);
        process.stdout.write(`   seq=${String(i + 1).padStart(2)} time=${latency.toFixed(1)} ms\n`);
        measurementCompleted = true;
      } catch (_) {
        if (retry === 1) {
          pingLost++;
          process.stdout.write(`   seq=${String(i + 1).padStart(2)} ${RED}LOST${RESET}\n`);
        } else {
          await sleep(20);
        }
      }
    }
    await sleep(CONFIG.PING_INTERVAL_MS);
  }

  if (latencies.length === 0) {
    console.error(`\n${RED}[ERROR] Ping phase failed completely.${RESET}`);
    process.exit(1);
  }

  const avgPing = calculateTrimmedMean(latencies);
  const minPing = calculateMin(latencies);
  const maxPing = calculateMax(latencies);
  const jitter = calculateFilteredJitter(latencies);

  console.log(`\n   --- Ping Statistics ---`);
  console.log(`   Packets: Sent = ${pingSent}, Received = ${latencies.length}, Lost = ${pingLost} (${((pingLost / pingSent) * 100).toFixed(1)}% loss)`);
  console.log(`   RTT:     Min = ${minPing.toFixed(1)}ms, Avg = ${avgPing.toFixed(1)}ms, Max = ${maxPing.toFixed(1)}ms`);
  console.log(`   Jitter:  ${jitter.toFixed(1)} ms (MAD-filtered RMS)`);
  console.log(`   Note:    HTTP RTT includes TLS+HTTP/2 overhead (~5-10ms vs ICMP)`);

  // ─── 4. Download Test (streaming, 6 parallel, same phases as web) ───
  console.log(`\n${BOLD}4. Measuring download speed (6 parallel streams, streaming)...${RESET}`);

  // BDP-based dynamic warmup/ramp (same calculation as web)
  const rttSec = avgPing / 1000;
  const estimatedBandwidthBps = 10_000_000; // 10 Mbps fallback (same as web when Network Info API unavailable)
  const bdpBytes = estimatedBandwidthBps * rttSec;
  const dynamicWarmupMs = Math.min(CONFIG.DYNAMIC_WARMUP_MAX_MS, Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000)));
  const dynamicRampMs = Math.min(CONFIG.DYNAMIC_RAMP_MAX_MS, Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000)));

  console.log(`   BDP: ${(bdpBytes / 1024).toFixed(1)} KB, warmup: ${dynamicWarmupMs}ms, ramp: ${dynamicRampMs}ms`);

  const dlStartTime = performance.now();
  let totalBytesDownloaded = 0;
  const parallelStreams = CONFIG.PARALLEL_STREAMS;
  const perStreamBytes = Math.ceil((500 * 1024 * 1024) / parallelStreams);

  // Phase timing boundaries
  let warmupEndMs = dynamicWarmupMs;
  let rampEndMs = warmupEndMs + dynamicRampMs;
  let measureEndMs = rampEndMs + CONFIG.DOWNLOAD_MEASURE_MS;
  let peakEndMs = measureEndMs + CONFIG.DOWNLOAD_PEAK_MS;

  // Phase byte tracking
  let measurementStartTime = null;
  let measurementEndTime = null;
  let phase3StartBytes = 0;
  let phase3EndBytes = 0;
  let allInstantaneousSpeeds = [];

  // Progress monitor — 100ms interval (same as web)
  const downloadHistory = [];

  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - dlStartTime;

    // Sliding window instantaneous speed
    downloadHistory.push({ time: now, bytes: totalBytesDownloaded });
    const windowStart = now - 1000;
    while (downloadHistory.length > 0 && downloadHistory[0].time < windowStart) downloadHistory.shift();

    let instSpeedBps = 0;
    if (downloadHistory.length >= 2) {
      const oldest = downloadHistory[0];
      const newest = downloadHistory[downloadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    // Collect instantaneous speeds during measurement phase only (Phase 3)
    const measureWindowStart = rampEndMs + (measureEndMs - rampEndMs) * 0.1;
    const inMeasurement = elapsedMs >= measureWindowStart && elapsedMs < measureEndMs;
    if (inMeasurement && instSpeedBps > 0) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    // Track phase byte boundaries
    if (elapsedMs >= rampEndMs && measurementStartTime === null) {
      measurementStartTime = performance.now();
      phase3StartBytes = totalBytesDownloaded;
    }
    if (elapsedMs >= measureEndMs && measurementEndTime === null) {
      measurementEndTime = performance.now();
      phase3EndBytes = totalBytesDownloaded;
    }

    // Progress bar
    const totalExpectedSec = (dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) / 1000;
    const pct = Math.min(100, Math.round((elapsedMs / 1000 / totalExpectedSec) * 100));
    const dlMbps = instSpeedBps / 1_000_000;
    const barLen = Math.floor(pct / 5);
    const bar = "█".repeat(barLen) + " ".repeat(20 - barLen);
    const mbTransferred = (totalBytesDownloaded / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r   Download: ${dlMbps.toFixed(1)} Mbps [${bar}] ${pct}% (${mbTransferred} MB)  `);
  }, 100);

  // Streaming download — one long-lived connection per stream (same as web worker)
  const runStream = async (streamIndex) => {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const url = `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=${perStreamBytes}&cb=${Date.now()}-${Math.random()}-${streamIndex}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.body) throw new Error("ReadableStream not supported");

        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totalBytesDownloaded += value.length;
        }
        reader.cancel().catch(() => {});
        return; // success
      } catch (_) {
        if (attempt < 2) await sleep(100 * (attempt + 1));
      }
    }
  };

  // Launch parallel streams and wait for test duration
  const streamPromises = Array.from({ length: parallelStreams }, (_, i) => runStream(i));

  // Wait for total test duration then abort streams
  await sleep(peakEndMs);
  // Streams will complete on their own when they finish reading

  clearInterval(progressInterval);

  // Wait briefly for in-flight streams to finish
  await Promise.race([
    Promise.all(streamPromises).catch(() => {}),
    sleep(2000),
  ]);

  // Calculate final average from Phase 3 (measurement) only
  let finalDlMbps = 0;
  if (measurementStartTime !== null && measurementEndTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    const phase3ElapsedSec = (measurementEndTime - measurementStartTime) / 1000;
    finalDlMbps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec / 1_000_000
      : 0;
  } else {
    const elapsedSec = (performance.now() - dlStartTime) / 1000;
    finalDlMbps = elapsedSec > 0.1 ? (totalBytesDownloaded * 8) / elapsedSec / 1_000_000 : 0;
  }

  // Peak = 95th percentile of Phase 3 instantaneous speeds (Nearest Rank)
  let dlPeak = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    dlPeak = sorted[p95Index] / 1_000_000;
  }

  process.stdout.write(`\r${" ".repeat(80)}\r`);
  console.log(`   Download: ${BOLD}${GREEN}${finalDlMbps.toFixed(1)} Mbps${RESET} [Peak: ${dlPeak.toFixed(1)} Mbps] (Total: ${(totalBytesDownloaded / (1024 * 1024)).toFixed(1)} MB)`);

  // ─── 5. Upload Test (adaptive chunks, same phases as web) ───
  console.log(`\n${BOLD}5. Measuring upload speed (${parallelStreams} streams, adaptive chunks)...${RESET}`);

  // Adaptive upload chunk sizing based on measured download speed
  const measuredDlBps = finalDlMbps * 1_000_000;
  const uploadEstimate = measuredDlBps > 0 ? measuredDlBps * 0.2 : 1_000_000;
  let adaptiveMinChunk = CONFIG.UPLOAD_MIN_CHUNK;
  if (uploadEstimate > 0) {
    const targetBytes = (uploadEstimate * 0.5) / 8;
    adaptiveMinChunk = Math.max(16 * 1024, Math.min(256 * 1024, Math.floor(targetBytes)));
  }

  const ulStartTime = performance.now();
  let completedBytes = 0;

  // Phase timing
  let ulMeasurementStartTime = null;
  let ulMeasurementEndTime = null;
  let ulMeasurementPhaseStarted = false;
  let phase3StartBytesUl = 0;
  let phase3EndBytesUl = 0;
  const allUlInstantaneousSpeeds = [];
  const ulUploadHistory = [];

  // Progress monitor
  const ulProgressInterval = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - ulStartTime;

    ulUploadHistory.push({ time: now, bytes: completedBytes });
    const windowStart = now - 1000;
    while (ulUploadHistory.length > 0 && ulUploadHistory[0].time < windowStart) ulUploadHistory.shift();

    let instSpeedBps = 0;
    if (ulUploadHistory.length >= 2) {
      const oldest = ulUploadHistory[0];
      const newest = ulUploadHistory[ulUploadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    if (ulMeasurementPhaseStarted && instSpeedBps > 0) {
      allUlInstantaneousSpeeds.push(instSpeedBps);
    }

    const totalExpectedUlSec = (dynamicWarmupMs + dynamicRampMs + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) / 1000;
    const pct = Math.min(100, Math.round((elapsedMs / 1000 / totalExpectedUlSec) * 100));
    const ulMbps = instSpeedBps / 1_000_000;
    const barLen = Math.floor(pct / 5);
    const bar = "█".repeat(barLen) + " ".repeat(20 - barLen);
    const mbTransferred = (completedBytes / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r   Upload: ${ulMbps.toFixed(1)} Mbps [${bar}] ${pct}% (${mbTransferred} MB)  `);
  }, 100);

  // Run upload phase — streams upload sequentially within phase
  const runUploadPhase = async (phaseDuration) => {
    return new Promise(async (resolvePhase) => {
      const phaseStart = performance.now();
      let nextChunkSize = adaptiveMinChunk;

      const runStream = async () => {
        while (performance.now() - phaseStart < phaseDuration) {
          const currentChunkSize = nextChunkSize;
          const chunkStart = performance.now();

          try {
            // Use text/plain to avoid CORS preflight — same as web worker
            const url = `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__up?bytes=${currentChunkSize}&cb=${Date.now()}-${Math.random()}`;
            const res = await fetch(url, {
              method: 'POST',
              body: generateRandomText(currentChunkSize),
              // No Content-Type header — browser defaults to text/plain;charset=UTF-8
              // which is a CORS-safelisted content type (no preflight).
            });

            const uploadCompleteTime = performance.now();
            res.text().catch(() => {}); // drain response body

            if (res.ok) {
              completedBytes += currentChunkSize;

              // Dynamic chunk sizing — target ~500ms per chunk
              const chunkDuration = uploadCompleteTime - chunkStart;
              if (chunkDuration > 0) {
                const chunkSpeed = (currentChunkSize * 8) / (chunkDuration / 1000);
                nextChunkSize = Math.floor((chunkSpeed * 0.5) / 8);
                nextChunkSize = Math.max(adaptiveMinChunk, Math.min(nextChunkSize, CONFIG.UPLOAD_MAX_CHUNK));
              }
            }
          } catch (_) {
            // Skip failed chunks
          }
        }
      };

      const streams = Array.from({ length: parallelStreams }, () => runStream());
      await Promise.all(streams).catch(() => {});
      resolvePhase();
    });
  };

  // Phase 1: warmup
  await runUploadPhase(dynamicWarmupMs);

  // Phase 2: ramp
  await runUploadPhase(dynamicRampMs);

  // Synchronization barrier — wait for in-flight data to drain
  {
    let lastByteCount = completedBytes;
    let stableMs = 0;
    while (stableMs < 250) {
      await sleep(50);
      if (completedBytes === lastByteCount) {
        stableMs += 50;
      } else {
        lastByteCount = completedBytes;
        stableMs = 0;
      }
    }
  }

  // Phase 3: measurement
  phase3StartBytesUl = completedBytes;
  ulMeasurementStartTime = performance.now();
  ulMeasurementPhaseStarted = true;
  await runUploadPhase(CONFIG.UPLOAD_MEASURE_MS);
  ulMeasurementEndTime = performance.now();
  ulMeasurementPhaseStarted = false;
  phase3EndBytesUl = completedBytes;

  // Phase 4: peak
  await runUploadPhase(CONFIG.UPLOAD_PEAK_MS);

  clearInterval(ulProgressInterval);

  // Calculate final average from Phase 3 only
  let finalUlMbps = 0;
  if (ulMeasurementStartTime !== null && ulMeasurementEndTime !== null) {
    const phase3Bytes = phase3EndBytesUl - phase3StartBytesUl;
    const phase3ElapsedSec = (ulMeasurementEndTime - ulMeasurementStartTime) / 1000;
    finalUlMbps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec / 1_000_000
      : 0;
  }

  // Peak = 95th percentile (Nearest Rank)
  let ulPeak = 0;
  if (allUlInstantaneousSpeeds.length > 0) {
    const sorted = [...allUlInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    ulPeak = sorted[p95Index] / 1_000_000;
  }

  process.stdout.write(`\r${" ".repeat(80)}\r`);
  console.log(`   Upload:   ${BOLD}${GREEN}${finalUlMbps.toFixed(1)} Mbps${RESET} [Peak: ${ulPeak.toFixed(1)} Mbps] (Total: ${(completedBytes / (1024 * 1024)).toFixed(1)} MB)`);

  // ─── 6. Packet Loss Test (100 pings, same as web) ───
  console.log(`\n${BOLD}6. Measuring packet loss (${CONFIG.PACKET_LOSS_PINGS} pings)...${RESET}`);
  let plSent = 0;
  let plLost = 0;

  // Warmup connection
  try {
    const res = await fetch(buildLatencyUrl(`pl-warmup-${Date.now()}`), { cache: "no-store" });
    if (res.status !== 204) await res.text();
  } catch (_) {}

  for (let i = 0; i < CONFIG.PACKET_LOSS_PINGS; i++) {
    plSent++;
    try {
      const res = await fetch(buildLatencyUrl(`pl-${i}-${Date.now()}`), { cache: "no-store" });
      if (!res.ok) {
        plLost++;
      } else {
        if (res.status !== 204) await res.text();
      }
    } catch (_) {
      plLost++;
    }

    const pct = Math.min(100, Math.round((i + 1) / CONFIG.PACKET_LOSS_PINGS * 100));
    const barLen = Math.floor(pct / 5);
    const bar = "█".repeat(barLen) + " ".repeat(20 - barLen);
    process.stdout.write(`\r   Packet Loss: [${bar}] ${pct}% (${plLost}/${plSent} lost)  `);

    if (i < CONFIG.PACKET_LOSS_PINGS - 1) {
      await sleep(CONFIG.PACKET_LOSS_INTERVAL_MS);
    }
  }

  const lossPercent = plSent > 0 ? (plLost / plSent) * 100 : 0;

  process.stdout.write(`\r${" ".repeat(80)}\r`);
  console.log(`   Packet Loss: ${lossPercent > 0 ? RED : GREEN}${lossPercent.toFixed(1)}%${RESET} (${plLost}/${plSent} packets lost, HTTP-level)`);

  // ─── 7. Final Report ───
  console.log(`\n${BOLD}==================================================${RESET}`);
  console.log(`${BOLD}${GREEN}               SPEEDTEST CLI SUMMARY${RESET}`);
  console.log(`${BOLD}==================================================${RESET}`);
  console.log(`  Target:            speed.cloudflare.com (Cloudflare Anycast)`);
  console.log(`  Unloaded Ping:     ${GREEN}${avgPing.toFixed(1)} ms${RESET} (trimmed mean, HTTP RTT)`);
  console.log(`  Jitter:            ${GREEN}${jitter.toFixed(1)} ms${RESET} (MAD-filtered RMS)`);
  console.log(`  Packet Loss:       ${lossPercent > 0 ? RED : GREEN}${lossPercent.toFixed(1)} %${RESET} (HTTP-level)`);
  console.log(`  Download Speed:    ${BOLD}${CYAN}${finalDlMbps.toFixed(1)} Mbps${RESET} (Peak: ${dlPeak.toFixed(1)} Mbps)`);
  console.log(`  Upload Speed:      ${BOLD}${CYAN}${finalUlMbps.toFixed(1)} Mbps${RESET} (Peak: ${ulPeak.toFixed(1)} Mbps)`);
  console.log(`  Streams:           ${parallelStreams} parallel`);
  console.log(`  Method:            Streaming (long-lived connections)`);
  console.log(`${BOLD}==================================================${RESET}\n`);
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
