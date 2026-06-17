// Network Speed Test Worker Engine

let activeAbortController: AbortController | null = null;
let isCancelled = false;
let hostLatency = 0;

import {
  sleep,
  isLocalHost,
  calculateMean,
  calculateJitter,
} from "../utils/speedTestUtils";


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
      } = e.data;
      await runDownloadTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams || 1,
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
      } = e.data;
      await runUploadTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams || 1,
        downloadSpeed || 0,
        activeAbortController.signal,
      );
    }
  } catch (error: any) {
    if (error.name === "AbortError" || isCancelled) {
      self.postMessage({ type: "ERROR", message: "Test cancelled" });
    } else {
      self.postMessage({
        type: "ERROR",
        message: error.message || "An error occurred during testing",
      });
    }
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
    // Warmup failures are ignored, default to a sensible 15ms
    hostLatency = 15;
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
 */
async function runDownloadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  basePing: number,
  parallelStreams: number,
  signal: AbortSignal,
) {
  const durationMs = 10000; // 10 seconds test window

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

  // Track stable measurement start time and bytes (measurement phase starts at ~3.5s)
  let measurementStartTime: number | null = null;
  let measurementStartBytes: number | null = null;
  const measurementStartSec = 3.5;

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
      activePingTimeout = setTimeout(runPingLoop, 800);
    }
  };

  runPingLoop();

  const downloadRequests: any[] = [];

  // Determine chunk size based on elapsed time (ramp-up schedule)
  const getChunkSize = (elapsedMs: number): number => {
    if (elapsedMs < 1500) return 100 * 1024;       // 0–1.5s:  100 KB warmup
    if (elapsedMs < 4000) return 1 * 1024 * 1024;   // 1.5–4s:  1 MB ramp-up
    if (elapsedMs < 7500) return 10 * 1024 * 1024;  // 4–7.5s:  10 MB measurement
    return 25 * 1024 * 1024;                         // 7.5–10s: 25 MB peak
  };

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

    // Calculate peak as 90th percentile of instantaneous speeds
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p90Index = Math.floor(sorted.length * 0.9);
      peakSpeed = sorted[Math.min(p90Index, sorted.length - 1)];
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

  // Single continuous download per stream — no phase gaps
  const runStream = async () => {
    while (!signal.aborted && !isCancelled) {
      const elapsedMs = performance.now() - startTime;
      if (elapsedMs >= durationMs) break;

      const targetSize = getChunkSize(elapsedMs);
      const chunkStart = performance.now();
      const requestTimestamp = Date.now();

      try {
        const url = region
          ? `${baseUrl}/download?size=${targetSize}&region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
          : `${baseUrl}/download?size=${targetSize}&cb=${Date.now()}-${Math.random()}`;

        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: {
            "Cache-Control": "no-store, no-cache",
          },
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
          while (!signal.aborted && !isCancelled) {
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
          reader.cancel().catch(() => {});

          // Snapshot measurement phase start (at ~3.5s elapsed)
          if (
            measurementStartTime === null &&
            (chunkStart - startTime) / 1000 >= measurementStartSec
          ) {
            measurementStartTime = chunkStart;
            measurementStartBytes = totalBytesDownloaded - bytesReceived;
          }

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
              payloadSize: targetSize,
              phaseSize: targetSize,
              latency,
              bps,
              duration: chunkDuration,
              serverTime: -1,
              responseSize: bytesReceived,
              loadedLatencies: requestPings,
            });
          }
        }
        } catch (err) {
        if (signal.aborted || isCancelled) break;
        await sleep(50);
      }

      // Brief pause between chunks to avoid triggering Cloudflare rate limits
      if (!signal.aborted && !isCancelled) {
        const elapsedMs = performance.now() - startTime;
        if (elapsedMs < durationMs) {
          await sleep(30);
        }
      }
    }
  };

  // Launch all parallel streams concurrently — they run continuously for the full 10s
  const streams = Array.from({ length: parallelStreams }).map(() => runStream());
  await Promise.all(streams).catch(() => {});

  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  // Calculate final average speed using wall-clock time of measurement phase (3.5s–10s)
  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null && measurementStartBytes !== null) {
    const elapsedSec = (performance.now() - measurementStartTime) / 1000;
    const bytesTransferred = totalBytesDownloaded - measurementStartBytes;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (bytesTransferred * 8) / elapsedSec : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesDownloaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 90th percentile of all instantaneous speeds
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p90Index = Math.floor(sorted.length * 0.9);
    finalPeakSpeed = sorted[Math.min(p90Index, sorted.length - 1)];
  }

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
  });
}

/**
 * 3. Upload Test Engine (Concurrent streams uploading random data sequentially)
 */
async function runUploadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  basePing: number,
  parallelStreams: number,
  downloadSpeed: number,
  signal: AbortSignal,
) {
  const durationMs = 10000; // 10 seconds test window for stable throughput measurement
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
  // Track currently in-flight progress bytes
  const activeRequests = new Map<string, number>();

  // Speed estimation for dynamic chunk sizing
  let currentSpeedEstimate = 1000 * 1000; // start with 1 Mbps estimate
  let nextChunkSize = 64 * 1024; // start with a small, safe chunk size (64 KB)

  // Track stable measurement start time and bytes
  let measurementStartTime: number | null = null;
  let measurementStartBytes: number | null = null;

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
      activePingTimeout = setTimeout(runPingLoop, 800);
    }
  };

  runPingLoop();

  const uploadRequests: any[] = [];

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();

    // Sum up completed bytes and currently active in-flight bytes
    let activeBytes = 0;
    for (const bytes of activeRequests.values()) {
      activeBytes += bytes;
    }
    totalBytesUploaded = completedBytes + activeBytes;

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

    // Calculate peak as 90th percentile of instantaneous speeds
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p90Index = Math.floor(sorted.length * 0.9);
      peakSpeed = sorted[Math.min(p90Index, sorted.length - 1)];
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

  // Pre-generate a reuseable pool of random data chunks to save CPU overhead (25MB max chunk)
  const maxAllocSize = 25 * 1024 * 1024;
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

  // Run a single continuous upload phase
  const runUploadPhase = (targetSize: number, phaseDuration: number) => {
    return new Promise<void>(async (resolvePhase) => {
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();
      const activeXhrs: XMLHttpRequest[] = [];

      const abortHandler = () => {
        phaseAbortController.abort();
        [...activeXhrs].forEach((x) => x.abort());
      };
      signal.addEventListener("abort", abortHandler);

      const runStream = () => {
        return new Promise<void>((resolveStream) => {
          if (
            performance.now() - phaseStart >= phaseDuration ||
            phaseAbortController.signal.aborted ||
            isCancelled
          ) {
            resolveStream();
            return;
          }

          // Use the dynamically adjusted chunk size
          const currentChunkSize = nextChunkSize;
          const uploadChunk = randomDataPool.subarray(0, currentChunkSize);

          const xhr = new XMLHttpRequest();
          activeXhrs.push(xhr);

          // Unique request ID to track its progress separately
          const reqId = Math.random().toString(36).substring(2, 15);

          const url = region
            ? `${baseUrl}/upload?region=${region}&serverId=${serverId || ""}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
            : `${baseUrl}/upload?cb=${Date.now()}-${Math.random()}`;

          xhr.open("POST", url, true);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("Cache-Control", "no-store, no-cache");

          const chunkStart = performance.now();
          const requestTimestamp = Date.now();
          let lastLoaded = 0;
          let recorded = false;
          let chunkBytesReported = 0;

          const recordStats = (completed: boolean) => {
            if (recorded) return;
            recorded = true;

            const chunkEnd = performance.now();
            const duration = chunkEnd - chunkStart;
            const bytesSent = completed ? currentChunkSize : chunkBytesReported;
            const bps = duration > 0 ? (bytesSent * 8) / (duration / 1000) : 0;

            const requestPings = pingLog
              .filter((p) => p.time >= chunkStart && p.time <= chunkEnd)
              .map((p) => p.latency);

            uploadRequests.push({
              time: requestTimestamp,
              direction: "upload",
              bytes: bytesSent,
              payloadSize: targetSize,
              phaseSize: targetSize,
              latency: 0,
              bps,
              duration,
              serverTime: -1,
              responseSize: completed ? xhr.responseText.length : 0,
              loadedLatencies: requestPings,
            });
          };

          // Track incremental bytes via xhr.upload.progress for smooth UI updates
          xhr.upload.addEventListener("progress", (event) => {
            if (event.loaded > lastLoaded) {
              if (firstByteTime === null) {
                firstByteTime = performance.now();
              }

              const bytesDelta = event.loaded - lastLoaded;
              
              // Register progress in the activeRequests map
              activeRequests.set(reqId, event.loaded);

              lastLoaded = event.loaded;
              chunkBytesReported = event.loaded;
            }
          });

          xhr.onload = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);
            activeRequests.delete(reqId);

            if (xhr.status === 200) {
              if (firstByteTime === null) {
                firstByteTime = chunkStart;
              }
              
              // Successfully uploaded
              completedBytes += currentChunkSize;

              // Dynamically adjust chunk size based on speed of this completed chunk
              const chunkEnd = performance.now();
              const chunkDuration = chunkEnd - chunkStart;
              if (chunkDuration > 0) {
                const chunkSpeed = (currentChunkSize * 8) / (chunkDuration / 1000);
                currentSpeedEstimate = currentSpeedEstimate * 0.6 + chunkSpeed * 0.4;
                nextChunkSize = Math.floor((currentSpeedEstimate * 0.3) / 8);
                nextChunkSize = Math.max(64 * 1024, Math.min(nextChunkSize, 5 * 1024 * 1024));
              }

              recordStats(true);
              // Brief pause between uploads to avoid triggering Cloudflare rate limits
              new Promise<void>((r) => setTimeout(r, 30)).then(() => runStream().then(resolveStream));
            } else {
              recordStats(false);
              resolveStream();
            }
          };

          xhr.onerror = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);
            activeRequests.delete(reqId);
            recordStats(false);
            resolveStream();
          };

          xhr.onabort = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);
            activeRequests.delete(reqId);
            recordStats(false);
            resolveStream();
          };

          xhr.send(uploadChunk);
        });
      };

      // Launch parallel streams
      const streams = Array.from({ length: parallelStreams }).map(() =>
        runStream(),
      );

      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
        [...activeXhrs].forEach((x) => x.abort());
      }, phaseDuration);

      await Promise.all(streams).catch(() => { });
      clearTimeout(phaseTimer);
      signal.removeEventListener("abort", abortHandler);
      [...activeXhrs].forEach((x) => x.abort());
      resolvePhase();
    });
  };

  // Run upload tests progressively across 4 sequential phases:
  // Phase 1: warmup - establish TCP connection
  await runUploadPhase(100 * 1024, 1500);

  // Phase 2: ramp-up - TCP slow-start
  if (!signal.aborted && !isCancelled) {
    await runUploadPhase(1 * 1024 * 1024, 2500);
  }

  // Phase 3: main measurement - stable throughput
  if (!signal.aborted && !isCancelled) {
    measurementStartTime = performance.now();
    measurementStartBytes = completedBytes;
    await runUploadPhase(10 * 1024 * 1024, 3500);
  }

  // Phase 4: peak measurement - max throughput
  if (!signal.aborted && !isCancelled) {
    await runUploadPhase(25 * 1024 * 1024, 2500);
  }

  // Clean up
  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  // Fallback to activeRequests progress if no chunk completed (e.g. extremely slow line)
  let finalBytes = completedBytes;
  if (finalBytes === 0) {
    let activeBytes = 0;
    for (const bytes of activeRequests.values()) {
      activeBytes += bytes;
    }
    finalBytes = activeBytes;
  }
  totalBytesUploaded = finalBytes;

  // Calculate final average speed using wall-clock time of measurement phase (Phase 3 + 4)
  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null && measurementStartBytes !== null) {
    const elapsedSec = (performance.now() - measurementStartTime) / 1000;
    const bytesTransferred = totalBytesUploaded - measurementStartBytes;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (bytesTransferred * 8) / elapsedSec : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesUploaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 90th percentile of all instantaneous speeds
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p90Index = Math.floor(sorted.length * 0.9);
    finalPeakSpeed = sorted[Math.min(p90Index, sorted.length - 1)];
  }

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
  });
}
