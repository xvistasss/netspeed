// Network Speed Test Worker Engine

let activeAbortController: AbortController | null = null;
let isCancelled = false;
let hostLatency = 0;

import {
  sleep,
  sleepWithAbort,
  isLocalHost,
  calculateMean,
  calculateJitter,
} from "../utils/speedTestUtils";
import { CONFIG } from "../utils/speedTestConfig";


// Listen for commands from the main thread
self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "CANCEL") {
    isCancelled = true;
    if (activeAbortController) {
      activeAbortController.abort();
    }
    self.postMessage({ type: "CANCELLED" });
    return;
  }

  isCancelled = false;
  activeAbortController = new AbortController();

  try {
    if (type === "START_PING") {
      const { baseUrl, region, serverId, clientLat, clientLon } = e.data;
      await runPingTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        activeAbortController.signal,
      );
    } else if (type === "START_DOWNLOAD") {
      const {
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams,
        dynamicWarmupMs,
        dynamicRampMs,
      } = e.data;
      await runDownloadTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams || CONFIG.PARALLEL_STREAMS_DEFAULT,
        dynamicWarmupMs || CONFIG.DOWNLOAD_WARMUP_MS,
        dynamicRampMs || CONFIG.DOWNLOAD_RAMP_MS,
        activeAbortController.signal,
      );
    } else if (type === "START_UPLOAD") {
      const {
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams,
        downloadSpeed,
        dynamicWarmupMs,
        dynamicRampMs,
      } = e.data;
      await runUploadTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams || CONFIG.PARALLEL_STREAMS_DEFAULT,
        downloadSpeed || 0,
        dynamicWarmupMs || CONFIG.UPLOAD_WARMUP_MS,
        dynamicRampMs || CONFIG.UPLOAD_RAMP_MS,
        activeAbortController.signal,
      );
    } else if (type === "START_PACKET_LOSS") {
      const { baseUrl, region, serverId, clientLat, clientLon } = e.data;
      await runPacketLossTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        activeAbortController.signal,
      );
    }
  } catch (error: any) {
    if (error.name === "AbortError" || isCancelled) {
      // Already sent CANCELLED message above; don't send duplicate ERROR
      return;
    }
    self.postMessage({
      type: "ERROR",
      message: error.message || "An error occurred during testing",
    });
  }
};

/**
 * 1. Ping & Jitter Test Engine
 */
async function runPingTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  signal: AbortSignal,
) {
  const iterations = 15;
  const latencies: number[] = [];
  let jitter = 0;
  let pingSent = 0;
  let pingLost = 0;

  // 1. Connection Warm-up Request (establishes TCP/TLS keep-alive)
  try {
    const warmupUrl = region
      ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&warmup=true&cb=warmup-${Date.now()}`
      : `${baseUrl}/ping?warmup=true&cb=warmup-${Date.now()}`;
    const startWarmup = performance.now();
    const res = await fetch(warmupUrl, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    await res.text();
    hostLatency = performance.now() - startWarmup;
  } catch (_) {
    // Warmup failures are ignored — no artificial latency floor.
    hostLatency = 0;
  }

  // 2. Real latency measurements
  for (let i = 0; i < iterations; i++) {
    if (isCancelled || signal.aborted) break;

    pingSent++;
    const start = performance.now();
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=${Date.now()}-${i}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=${Date.now()}-${i}`;
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        throw new Error("Ping request failed");
      }

      await response.text(); // Fully read response body

      const end = performance.now();
      let latency = end - start;
      if (isLocalHost(baseUrl)) {
        latency = Math.max(1.5, latency);
      }
      latencies.push(latency);

      jitter = calculateJitter(latencies);

      // Stream progress
      self.postMessage({
        type: "PING_PROGRESS",
        iteration: i + 1,
        totalIterations: iterations,
        latency,
        jitter,
        latencies: [...latencies],
        pingSent,
        pingLost,
      });

      // Brief sleep between pings to prevent queueing overhead
      await sleep(60);
    } catch (err) {
      if (signal.aborted) throw err;
      pingLost++;
      self.postMessage({
        type: "PING_FAILED_ITERATION",
        iteration: i + 1,
        pingSent,
        pingLost,
      });
    }
  }

  self.postMessage({
    type: "PING_COMPLETE",
    latencies,
    jitter,
    pingSent,
    pingLost,
  });
}

/**
 * 2. Download Test Engine (Single continuous download with dynamic chunk sizing)
 *
 * Uses one uninterrupted download stream per parallel connection.
 * Chunk sizes ramp up over time: warmup (100KB) → ramp (1MB) → measurement (10MB) → peak (25MB).
 * This eliminates gaps between sequential phases that caused instantaneous speed to drop to 0.
 * Phase boundaries are synchronized: all streams complete before the next phase captures its baseline.
 */
async function runDownloadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  basePing: number,
  parallelStreams: number,
  dynamicWarmupMs: number,
  dynamicRampMs: number,
  signal: AbortSignal,
) {
  const durationMs = CONFIG.DOWNLOAD_DURATION_MS;

  const startTime = performance.now();
  let totalBytesDownloaded = 0;
  let peakSpeed = 0;

  // Track loaded latency pings under download stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let dlPingSent = 0;
  let dlPingLost = 0;

  // Track loaded latency ping timestamps and values
  const pingLog: { time: number; latency: number }[] = [];

  // Sliding window samples for smooth instantaneous speed calculation
  const downloadHistory: { time: number; bytes: number }[] = [];
  let firstByteTime: number | null = null;

  // Collect all instantaneous speeds for percentile-based peak calculation
  const allInstantaneousSpeeds: number[] = [];

  // Track stable measurement start time (measurement phase starts at Phase 3)
  let measurementStartTime: number | null = null;
  let measurementPhaseStarted = false;

  // Background latency pinger under download stress (recursive timeout to avoid socket queueing)
  let activePingTimeout: any = null;
  const runPingLoop = async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) return;

    dlPingSent++;
    const pingStart = performance.now();
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=loaded-dl-${Date.now()}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=loaded-dl-${Date.now()}`;
      const res = await fetch(url, { signal, cache: "no-store" });
      if (res.ok) {
        await res.text();
        let lat = performance.now() - pingStart;
        if (isLocalHost(baseUrl)) {
          lat = Math.max(1.5, lat);
        }
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = calculateMean(loadedLatencies);
        loadedJitter = calculateJitter(loadedLatencies);
      } else {
        dlPingLost++;
      }
    } catch (_) {
      dlPingLost++;
    }

    if (!signal.aborted && performance.now() - startTime < durationMs) {
      activePingTimeout = setTimeout(runPingLoop, CONFIG.LOADED_PING_INTERVAL_MS);
    }
  };

  runPingLoop();

  const downloadRequests: any[] = [];

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();

    // Record the current snapshot
    downloadHistory.push({
      time: now,
      bytes: totalBytesDownloaded,
    });

    // Purge samples older than 1 second (1000ms)
    const windowStartLimit = now - 1000;
    while (downloadHistory.length > 0 && downloadHistory[0].time < windowStartLimit) {
      downloadHistory.shift();
    }

    // Calculate instantaneous speed using sliding window rate of change
    let instSpeedBps = 0;
    if (downloadHistory.length >= 2) {
      const oldest = downloadHistory[0];
      const newest = downloadHistory[downloadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    // Calculate elapsed time since test started
    const elapsedSinceStart = (now - startTime) / 1000;

    // Average speed: total bytes / total elapsed time (fallback / live average)
    const avgSpeedBps =
      elapsedSinceStart > 0.1
        ? (totalBytesDownloaded * 8) / elapsedSinceStart
        : 0;

    // Collect instantaneous speeds for percentile-based peak calculation (skip first 0.5s transient)
    if (instSpeedBps > 0 && elapsedSinceStart > 0.5) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    // Calculate peak as 95th percentile of instantaneous speeds
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      peakSpeed = sorted[Math.min(p95Index, sorted.length - 1)];
    }

    self.postMessage({
      type: "DOWNLOAD_PROGRESS",
      elapsedTime: elapsedSinceStart,
      totalBytes: totalBytesDownloaded,
      instantaneousSpeed: instSpeedBps,
      averageSpeed: avgSpeedBps,
      peakSpeed,
      loadedLatency: loadedAvg,
      loadedJitter: loadedJitter,
      loadedPingSent: dlPingSent,
      loadedPingLost: dlPingLost,
      loadedLatencies: [...loadedLatencies],
      requests: [...downloadRequests],
    });
  }, 100);

  // Run a single download phase: all parallel streams download chunks of `chunkSize` for `phaseDurationMs`
  const runDownloadPhase = (chunkSize: number, phaseDurationMs: number) => {
    return new Promise<void>((resolvePhase) => {
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();

      const abortHandler = () => {
        phaseAbortController.abort();
      };
      signal.addEventListener("abort", abortHandler);

      const runStream = async (): Promise<void> => {
        const useDirectCF = !isLocalHost(baseUrl);

        while (
          !signal.aborted &&
          !isCancelled &&
          !phaseAbortController.signal.aborted
        ) {
          const elapsedMs = performance.now() - phaseStart;
          if (elapsedMs >= phaseDurationMs) break;

          const requestTimestamp = Date.now();

          for (let attempt = 0; attempt <= CONFIG.MAX_CHUNK_RETRIES; attempt++) {
            if (signal.aborted || isCancelled || phaseAbortController.signal.aborted) break;

            const chunkStart = performance.now();

            try {
              const url = useDirectCF
                ? `https://speed.cloudflare.com/__down?bytes=${chunkSize}`
                : region
                  ? `${baseUrl}/download?size=${chunkSize}&region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
                  : `${baseUrl}/download?size=${chunkSize}&cb=${Date.now()}-${Math.random()}`;

              const fetchHeaders: Record<string, string> = useDirectCF
                ? {
                  Referer: "https://speed.cloudflare.com/",
                  Origin: "https://speed.cloudflare.com",
                  "Cache-Control": "no-store, no-cache",
                }
                : {
                  "Cache-Control": "no-store, no-cache",
                };

              const response = await fetch(url, {
                method: "GET",
                cache: "no-store",
                headers: fetchHeaders,
                signal,
              });

              const headersReceived = performance.now();
              const latency = headersReceived - chunkStart;

              if (!response.body) {
                throw new Error("ReadableStream not supported on download body");
              }

              const reader = response.body.getReader();
              let bytesReceived = 0;

              try {
                while (!signal.aborted && !isCancelled && !phaseAbortController.signal.aborted) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) {
                    if (firstByteTime === null) {
                      firstByteTime = headersReceived;
                    }
                    bytesReceived += value.length;
                    totalBytesDownloaded += value.length;
                  }
                }
              } finally {
                const chunkEnd = performance.now();
                reader.cancel().catch(() => { });

                // Record all chunks with data (including partial from aborted phases)
                // so large-payload requests (10MB, 25MB) appear in detailed measurements

                if (bytesReceived > 0) {
                  const chunkDuration = chunkEnd - headersReceived;
                  const bps =
                    chunkDuration > 0
                      ? (bytesReceived * 8) / (chunkDuration / 1000)
                      : 0;

                  const requestPings = pingLog
                    .filter((p) => p.time >= chunkStart && p.time <= chunkEnd)
                    .map((p) => p.latency);

                  downloadRequests.push({
                    time: requestTimestamp,
                    direction: "download",
                    bytes: bytesReceived,
                    payloadSize: chunkSize,
                    phaseSize: chunkSize,
                    latency,
                    bps,
                    duration: chunkDuration,
                    serverTime: -1,
                    responseSize: bytesReceived,
                    loadedLatencies: requestPings,
                  });
                }
              }

              break;
            } catch (err) {
              if (signal.aborted || isCancelled || phaseAbortController.signal.aborted) break;
              if (attempt < CONFIG.MAX_CHUNK_RETRIES) {
                await sleep(CONFIG.CHUNK_RETRY_DELAY_MS * (attempt + 1));
              }
            }
          }

          if (!signal.aborted && !isCancelled && !phaseAbortController.signal.aborted) {
            const elapsedMs = performance.now() - phaseStart;
            if (elapsedMs < phaseDurationMs) {
              await new Promise<void>((r) => setTimeout(r, 0));
            }
          }
        }
      };

      const streams = Array.from({ length: parallelStreams }).map(() => runStream());
      Promise.all(streams)
        .catch(() => { })
        .finally(() => {
          signal.removeEventListener("abort", abortHandler);
          resolvePhase();
        });

      // Auto-resolve when phase duration elapses
      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
      }, phaseDurationMs);
      phaseAbortController.signal.addEventListener("abort", () => clearTimeout(phaseTimer));
    });
  };

  // Run download tests progressively across 4 sequential phases:
  // Phase 1: warmup — establish TCP connection (dynamic duration based on BDP)
  await runDownloadPhase(CONFIG.CHUNK_WARMUP, dynamicWarmupMs);

  // Phase 2: ramp-up — TCP slow-start (dynamic duration based on BDP)
  if (!signal.aborted && !isCancelled) {
    await runDownloadPhase(CONFIG.CHUNK_RAMP, dynamicRampMs);
  }

  // Synchronization barrier: wait for all Phase 2 streams to drain completely.
  // Use multiple short waits to allow in-flight TCP segments to arrive,
  // preventing Phase 2 bytes from leaking into the Phase 3 measurement baseline.
  for (let w = 0; w < 5; w++) {
    await sleepWithAbort(50, signal);
  }

  // Phase 3: main measurement — stable throughput
  let phase3StartBytes = totalBytesDownloaded;
  let phase3EndBytes = totalBytesDownloaded;
  if (!signal.aborted && !isCancelled) {
    // Capture measurement baseline AFTER Phase 2 is fully drained
    measurementStartTime = performance.now();
    phase3StartBytes = totalBytesDownloaded;
    measurementPhaseStarted = true;
    await runDownloadPhase(CONFIG.CHUNK_MEASURE, CONFIG.DOWNLOAD_MEASURE_MS);
    phase3EndBytes = totalBytesDownloaded;
  }

  // Phase 4: peak measurement — max throughput
  if (!signal.aborted && !isCancelled) {
    await runDownloadPhase(CONFIG.CHUNK_PEAK, CONFIG.DOWNLOAD_PEAK_MS);
  }

  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  // Calculate final average speed using ONLY Phase 3 (measurement phase) data.
  // Phase 4 uses oversized chunks that don't represent steady-state throughput.
  let finalAvgSpeedBps = 0;
  if (measurementPhaseStarted && measurementStartTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    const phase3ElapsedSec = CONFIG.DOWNLOAD_MEASURE_MS / 1000;
    finalAvgSpeedBps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec
      : 0;
  } else {
    // Fallback: use full test duration
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesDownloaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 95th percentile of all instantaneous speeds.
  // Using 95th instead of 99th for statistical reliability with limited samples.
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    finalPeakSpeed = sorted[Math.min(p95Index, sorted.length - 1)];
  }

  // Validate measurement reliability
  const completedRequests = downloadRequests.filter((r) => r.bytes > 0 && r.bps > 0);
  const reliable = completedRequests.length >= 3 && finalAvgSpeedBps > 0;

  self.postMessage({
    type: "DOWNLOAD_COMPLETE",
    totalBytes: totalBytesDownloaded,
    averageSpeed: finalAvgSpeedBps,
    peakSpeed: finalPeakSpeed,
    loadedLatency: loadedAvg,
    loadedJitter: loadedJitter,
    loadedLatencies: loadedLatencies,
    loadedPingSent: dlPingSent,
    loadedPingLost: dlPingLost,
    requests: downloadRequests,
    reliable,
  });
}

/**
 * 3. Upload Test Engine (Concurrent streams uploading random data sequentially)
 * Uses adaptive chunk sizing and verified byte counts from the server.
 */
async function runUploadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  basePing: number,
  parallelStreams: number,
  _downloadSpeed: number,
  dynamicWarmupMs: number,
  dynamicRampMs: number,
  signal: AbortSignal,
) {
  const durationMs = CONFIG.UPLOAD_DURATION_MS;
  const startTime = performance.now();
  let totalBytesUploaded = 0;
  let peakSpeed = 0;

  // Track loaded latency pings under upload stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let ulPingSent = 0;
  let ulPingLost = 0;

  // Track loaded latency ping timestamps and values
  const pingLog: { time: number; latency: number }[] = [];

  // Sliding window samples for smooth instantaneous speed calculation
  const uploadHistory: { time: number; bytes: number }[] = [];
  let firstByteTime: number | null = null;

  // Collect all instantaneous speeds for percentile-based peak calculation
  const allInstantaneousSpeeds: number[] = [];

  // Track completed bytes from fully finished requests to prevent buffer bloat
  let completedBytes = 0;

  // Speed estimation for dynamic chunk sizing (per-stream to avoid race conditions)

  // Track stable measurement start time
  let measurementStartTime: number | null = null;

  // Background latency pinger under upload load (recursive timeout to avoid socket queueing)
  let activePingTimeout: any = null;
  const runPingLoop = async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) return;

    ulPingSent++;
    const pingStart = performance.now();
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=loaded-ul-${Date.now()}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=loaded-ul-${Date.now()}`;
      const res = await fetch(url, { signal, cache: "no-store" });
      if (res.ok) {
        await res.text();
        let lat = performance.now() - pingStart;
        if (isLocalHost(baseUrl)) {
          lat = Math.max(1.5, lat);
        }
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = calculateMean(loadedLatencies);
        loadedJitter = calculateJitter(loadedLatencies);
      } else {
        ulPingLost++;
      }
    } catch (_) {
      ulPingLost++;
    }

    if (!signal.aborted && performance.now() - startTime < durationMs) {
      activePingTimeout = setTimeout(runPingLoop, CONFIG.LOADED_PING_INTERVAL_MS);
    }
  };

  runPingLoop();

  const uploadRequests: any[] = [];

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();

    // Use completedBytes directly — each finished fetch increments it atomically
    totalBytesUploaded = completedBytes;

    // Record the current snapshot
    uploadHistory.push({
      time: now,
      bytes: totalBytesUploaded,
    });

    // Purge samples older than 1 second (1000ms)
    const windowStartLimit = now - 1000;
    while (uploadHistory.length > 0 && uploadHistory[0].time < windowStartLimit) {
      uploadHistory.shift();
    }

    // Calculate instantaneous speed using sliding window rate of change
    let instSpeedBps = 0;
    if (uploadHistory.length >= 2) {
      const oldest = uploadHistory[0];
      const newest = uploadHistory[uploadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    // Calculate elapsed time since test started
    const elapsedSinceStart = (now - startTime) / 1000;

    // Average speed: total bytes / total elapsed time (fallback / live average)
    const avgSpeedBps =
      elapsedSinceStart > 0.1
        ? (totalBytesUploaded * 8) / elapsedSinceStart
        : 0;

    // Collect instantaneous speeds for percentile-based peak calculation (skip first 0.5s transient)
    if (instSpeedBps > 0 && elapsedSinceStart > 0.5) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    // Calculate peak as 95th percentile of instantaneous speeds
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      peakSpeed = sorted[Math.min(p95Index, sorted.length - 1)];
    }

    self.postMessage({
      type: "UPLOAD_PROGRESS",
      elapsedTime: elapsedSinceStart,
      totalBytes: totalBytesUploaded,
      instantaneousSpeed: instSpeedBps,
      averageSpeed: avgSpeedBps,
      peakSpeed,
      loadedLatency: loadedAvg,
      loadedJitter: loadedJitter,
      loadedPingSent: ulPingSent,
      loadedPingLost: ulPingLost,
      loadedLatencies: [...loadedLatencies],
      requests: [...uploadRequests],
    });
  }, 100);

  // Pre-generate a reusable pool of random data chunks to save CPU overhead.
  // Reduced from 25MB to 2MB to minimize ArrayBuffer serialization overhead.
  const maxAllocSize = CONFIG.UPLOAD_MAX_CHUNK;
  const randomDataPool = new Uint8Array(maxAllocSize);
  if (self.crypto) {
    const maxQuota = 65536;
    for (let offset = 0; offset < randomDataPool.length; offset += maxQuota) {
      const subarray = randomDataPool.subarray(
        offset,
        Math.min(offset + maxQuota, randomDataPool.length),
      );
      self.crypto.getRandomValues(subarray);
    }
  } else {
    for (let i = 0; i < randomDataPool.length; i++) {
      randomDataPool[i] = Math.floor(Math.random() * 256);
    }
  }

  const useDirectCF = !isLocalHost(baseUrl);

  // Run a single continuous upload phase using fetch with ArrayBuffer body.
  // Progress is tracked at request-completion granularity (each completed chunk
  // increments completedBytes atomically). This avoids ReadableStream/Content-Length
  // issues while still providing accurate throughput measurement.
  const runUploadPhase = (targetSize: number, phaseDuration: number) => {
    return new Promise<void>(async (resolvePhase) => {
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();
      const activeFetchControllers: AbortController[] = [];

      const abortHandler = () => {
        phaseAbortController.abort();
        activeFetchControllers.forEach((c) => c.abort());
      };
      signal.addEventListener("abort", abortHandler);

      const runStream = async (): Promise<void> => {
        // Per-stream adaptive chunk sizing to avoid race conditions
        let streamSpeedEstimate = 1000 * 1000; // start with 1 Mbps estimate
        let streamNextChunkSize = 64 * 1024; // start with a small, safe chunk size (64 KB)

        while (
          !signal.aborted &&
          !isCancelled &&
          !phaseAbortController.signal.aborted
        ) {
          const elapsedMs = performance.now() - phaseStart;
          if (elapsedMs >= phaseDuration) break;

          const currentChunkSize = streamNextChunkSize;
          const uploadChunk = randomDataPool.subarray(0, currentChunkSize);

          const url = useDirectCF
            ? "https://speed.cloudflare.com/__up"
            : region
              ? `${baseUrl}/upload?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
              : `${baseUrl}/upload?cb=${Date.now()}-${Math.random()}`;

          const fetchHeaders: Record<string, string> = useDirectCF
            ? {
              "Content-Type": "application/octet-stream",
              Referer: "https://speed.cloudflare.com/",
              Origin: "https://speed.cloudflare.com",
              "Cache-Control": "no-store, no-cache",
            }
            : {
              "Content-Type": "application/octet-stream",
              "Cache-Control": "no-store, no-cache",
            };

          const chunkStart = performance.now();
          const requestTimestamp = Date.now();

          const fetchController = new AbortController();
          activeFetchControllers.push(fetchController);

          try {
            if (firstByteTime === null) {
              firstByteTime = chunkStart;
            }

            const response = await fetch(url, {
              method: "POST",
              headers: fetchHeaders,
              body: uploadChunk,
              signal: fetchController.signal,
            });

            // Measure upload completion when response headers arrive (fetch resolves),
            // NOT after response.text(). This eliminates server processing time
            // and response body download from the upload speed measurement.
            const uploadCompleteTime = performance.now();

            // Read response body in background to close the connection properly
            // but don't let it affect the speed measurement
            response.text().catch(() => {});

            if (response.ok) {
              completedBytes += currentChunkSize;

              // Dynamically adjust chunk size based on measured speed
              // Use targetDuration of 0.2s (200ms) for responsive chunk sizing
              const chunkDuration = uploadCompleteTime - chunkStart;
              if (chunkDuration > 0) {
                const chunkSpeed = (currentChunkSize * 8) / (chunkDuration / 1000);
                streamSpeedEstimate = streamSpeedEstimate * 0.6 + chunkSpeed * 0.4;
                // Target ~200ms per chunk for smooth progress reporting
                const targetDurationSec = 0.2;
                streamNextChunkSize = Math.floor((streamSpeedEstimate * targetDurationSec) / 8);
                streamNextChunkSize = Math.max(CONFIG.UPLOAD_MIN_CHUNK, Math.min(streamNextChunkSize, CONFIG.UPLOAD_MAX_CHUNK));
              }

              // Record this completed request
              const requestPings = pingLog
                .filter((p) => p.time >= chunkStart && p.time <= performance.now())
                .map((p) => p.latency);

              uploadRequests.push({
                time: requestTimestamp,
                direction: "upload",
                bytes: currentChunkSize,
                payloadSize: currentChunkSize,
                phaseSize: targetSize,
                latency: 0,
                bps: chunkDuration > 0 ? (currentChunkSize * 8) / (chunkDuration / 1000) : 0,
                duration: chunkDuration,
                serverTime: -1,
                responseSize: 0,
                loadedLatencies: requestPings,
              });

              // Brief pause between uploads to avoid triggering rate limits
              await sleep(30);
            }
          } catch (_err) {
            // Record failed request — set bytes to 0 since we can't confirm data was sent
            const chunkEnd = performance.now();
            const chunkDuration = chunkEnd - chunkStart;
            uploadRequests.push({
              time: requestTimestamp,
              direction: "upload",
              bytes: 0,
              payloadSize: currentChunkSize,
              phaseSize: targetSize,
              latency: 0,
              bps: 0,
              duration: chunkDuration,
              serverTime: -1,
              responseSize: 0,
              loadedLatencies: [],
            });
          } finally {
            const idx = activeFetchControllers.indexOf(fetchController);
            if (idx > -1) activeFetchControllers.splice(idx, 1);
          }
        }
      };

      // Launch parallel streams
      const streams = Array.from({ length: parallelStreams }).map(() =>
        runStream(),
      );

      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
        activeFetchControllers.forEach((c) => c.abort());
      }, phaseDuration);

      await Promise.all(streams).catch(() => { });
      clearTimeout(phaseTimer);
      signal.removeEventListener("abort", abortHandler);
      activeFetchControllers.forEach((c) => c.abort());
      resolvePhase();
    });
  };

  // Run upload tests progressively across 4 sequential phases:
  // Phase 1: warmup - establish TCP connection (dynamic duration based on BDP)
  await runUploadPhase(100 * 1024, dynamicWarmupMs);

  // Phase 2: ramp-up - TCP slow-start (dynamic duration based on BDP)
  if (!signal.aborted && !isCancelled) {
    await runUploadPhase(1 * 1024 * 1024, dynamicRampMs);
  }

  // Synchronization barrier: wait for all Phase 2 streams to drain completely.
  // Use multiple short waits to allow in-flight TCP segments to complete,
  // preventing Phase 2 bytes from leaking into the Phase 3 measurement baseline.
  for (let w = 0; w < 5; w++) {
    await sleepWithAbort(50, signal);
  }

  // Phase 3: main measurement - stable throughput
  let phase3StartBytes = completedBytes;
  let phase3EndBytes = completedBytes;
  if (!signal.aborted && !isCancelled) {
    measurementStartTime = performance.now();
    phase3StartBytes = completedBytes;
    await runUploadPhase(10 * 1024 * 1024, CONFIG.UPLOAD_MEASURE_MS);
    phase3EndBytes = completedBytes;
  }

  // Phase 4: peak measurement - max throughput
  if (!signal.aborted && !isCancelled) {
    await runUploadPhase(25 * 1024 * 1024, 2500);
  }

  // Clean up
  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  // Use completedBytes directly
  totalBytesUploaded = completedBytes;

  // Calculate final average speed using ONLY Phase 3 (measurement phase) data.
  // Phase 4 uses oversized chunks that don't represent steady-state throughput.
  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    const phase3ElapsedSec = CONFIG.UPLOAD_MEASURE_MS / 1000;
    finalAvgSpeedBps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec
      : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesUploaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 95th percentile of all instantaneous speeds.
  // Using 95th instead of 99th for statistical reliability with limited samples.
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    finalPeakSpeed = sorted[Math.min(p95Index, sorted.length - 1)];
  }

  // Validate measurement reliability
  const completedUploadRequests = uploadRequests.filter((r) => r.bytes > 0 && r.bps > 0);
  const reliable = completedUploadRequests.length >= 3 && finalAvgSpeedBps > 0;

  self.postMessage({
    type: "UPLOAD_COMPLETE",
    totalBytes: totalBytesUploaded,
    averageSpeed: finalAvgSpeedBps,
    peakSpeed: finalPeakSpeed,
    loadedLatency: loadedAvg,
    loadedJitter: loadedJitter,
    loadedLatencies: loadedLatencies,
    loadedPingSent: ulPingSent,
    loadedPingLost: ulPingLost,
    requests: uploadRequests,
    reliable,
  });
}

/**
 * 4. Dedicated Packet Loss Test Engine
 * Sends N rapid pings to measure actual packet loss, no random fallback.
 */
async function runPacketLossTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  signal: AbortSignal,
) {
  const totalPings = CONFIG.PACKET_LOSS_PINGS;
  const intervalMs = CONFIG.PACKET_LOSS_INTERVAL_MS;
  let sent = 0;
  let lost = 0;

  for (let i = 0; i < totalPings; i++) {
    if (isCancelled || signal.aborted) break;

    sent++;
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&cb=pl-${Date.now()}-${i}`
        : `${baseUrl}/ping?cb=pl-${Date.now()}-${i}`;

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal,
      });

      if (!res.ok) {
        lost++;
      } else {
        await res.text();
      }
    } catch (_) {
      lost++;
    }

    // Stream progress
    self.postMessage({
      type: "PACKET_LOSS_PROGRESS",
      iteration: i + 1,
      totalIterations: totalPings,
      sent,
      lost,
    });

    if (i < totalPings - 1) {
      await sleep(intervalMs);
    }
  }

  const lossPercent = sent > 0 ? (lost / sent) * 100 : 0;

  self.postMessage({
    type: "PACKET_LOSS_COMPLETE",
    sent,
    lost,
    lossPercent,
  });
}
