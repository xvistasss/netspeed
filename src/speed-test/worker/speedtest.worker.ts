// Network Speed Test Worker Engine

let activeAbortController: AbortController | null = null;
let isCancelled = false;

import {
  sleep,
  sleepWithAbort,
  calculateMean,
  calculateJitterRMS,
  calculateFilteredJitter,
  calculateTrimmedMean,
  buildDirectLatencyUrl,
  getLoadedPingInterval,
  getPacketLossInterval,
} from "../utils/speedTestUtils";
import { CONFIG } from "../utils/speedTestConfig";

// Import adaptive helpers
import { getAdaptiveUploadMinChunk, generateRandomText } from "../utils/speedTestUtils";


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
      const { baseUrl, region, serverId, clientLat, clientLon, networkType } = e.data;
      await runPingTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        activeAbortController.signal,
        networkType,
      );
    } else if (type === "START_DOWNLOAD") {
      const {
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        dynamicWarmupMs,
        dynamicRampMs,
        networkType,
      } = e.data;
      await runDownloadTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        CONFIG.PARALLEL_STREAMS_DEFAULT,
        dynamicWarmupMs || CONFIG.DOWNLOAD_WARMUP_MS,
        dynamicRampMs || CONFIG.DOWNLOAD_RAMP_MS,
        activeAbortController.signal,
        networkType,
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
        networkType,
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
        networkType,
      );
    } else if (type === "START_PACKET_LOSS") {
      const { baseUrl, region, serverId, clientLat, clientLon, networkType } = e.data;
      await runPacketLossTest(
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        activeAbortController.signal,
        networkType,
      );
    }
  } catch (error: any) {
    if (error.name === "AbortError" || isCancelled) {
      // Already sent CANCELLED message above; don't send duplicate ERROR
      return;
    }
    // Provide specific error messages for common failure modes
    let errorMessage = error.message || "An error occurred during testing";
    if (error.message?.includes("DNS") || error.message?.includes("resolve")) {
      errorMessage = "DNS resolution failed — check your internet connection";
    } else if (error.message?.includes("timeout") || error.name === "TimeoutError") {
      errorMessage = "Request timed out — network may be congested or unreachable";
    } else if (error.message?.includes("429") || error.message?.includes("rate limit")) {
      errorMessage = "Rate limited by server — retrying may help";
    } else if (error.message?.includes("ECONNRESET") || error.message?.includes("reset")) {
      errorMessage = "Connection reset by server — network instability detected";
    } else if (error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
      errorMessage = "Network error — check your connection and firewall settings";
    }
    self.postMessage({
      type: "ERROR",
      message: errorMessage,
    });
  }
};

/**
 * 1. Ping & Jitter Test Engine
 *
 * Measures HTTP-level RTT directly against speed.cloudflare.com (__down?bytes=1).
 * Uses the same Cloudflare edge infrastructure as download/upload tests, ensuring:
 *   - No Worker cold-start overhead or execution noise
 *   - Loaded latency shares the HTTP/2 connection pool with data streams
 *   - Consistent endpoint across all measurement phases
 *
 * The browser's HTTP/2 connection pool eliminates repeated TCP/TLS handshakes
 * after the first request, so steady-state pings approximate wire latency +
 * HTTP framing overhead (~1-3ms).
 */
async function runPingTest(
  _baseUrl: string,
  _region: string | undefined,
  _serverId: string | undefined,
  _clientLat: number,
  _clientLon: number,
  signal: AbortSignal,
  _networkType?: string,
) {
  const iterations = CONFIG.PING_ITERATIONS;
  const latencies: number[] = [];
  let jitter = 0;
  let pingSent = 0;
  let pingLost = 0;

  // 1. Connection Warm-up — 4 rapid requests to establish HTTP/2 connection.
  // The first request pays the TCP + TLS + HTTP/2 negotiation cost.
  // The second confirms the connection is alive. Third and fourth stabilize.
  // We measure warmup latencies to calibrate the HTTP→ICMP overhead offset.
  const warmupLatencies: number[] = [];
  try {
    for (let w = 0; w < 4; w++) {
      const startWarmup = performance.now();
      const res = await fetch(buildDirectLatencyUrl(`warmup-${w}-${Date.now()}`), {
        method: "GET",
        cache: "no-store",
        signal,
      });
      if (res.status !== 204) {
        await res.text();
      }
      warmupLatencies.push(performance.now() - startWarmup);
    }
  } catch (_) {
    // Warmup failures are ignored — measurement will proceed without connection priming.
  }

  // ICMP estimation uses fixed offsets (3ms WiFi, 5ms cellular) when WebRTC is
  // unavailable. The overhead is constant additive (~2-6ms), NOT proportional to RTT,
  // so a fixed offset is more accurate than a proportional heuristic.

  // 2. Real latency measurements
  for (let i = 0; i < iterations; i++) {
    if (isCancelled || signal.aborted) break;

    pingSent++;
    let measurementCompleted = false;
    
    // Retry logic: try up to 2 times for each ping measurement
    for (let retry = 0; retry < 2 && !measurementCompleted; retry++) {
      const start = performance.now();
      try {
        const suffix = `ping-${i}${retry > 0 ? `-retry${retry}` : ""}-${Date.now()}`;
        const response = await fetch(buildDirectLatencyUrl(suffix), {
          method: "GET",
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          throw new Error("Ping request failed");
        }

        if (response.status !== 204) {
          await response.text();
        }

        const latency = performance.now() - start;
        latencies.push(latency);

        // Use filtered jitter — removes outliers (GC pauses, OS hiccups)
        // before calculating RFC 3550 RMS jitter
        jitter = calculateFilteredJitter(latencies, CONFIG.JITTER_OUTLIER_SIGMA);

        // ICMP estimate is now computed by the main thread using network-type-aware logic
        // Pass raw average here; the main thread applies the appropriate factor
        const avgIcmpEquivalent = 0;

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
          avgIcmpEquivalent,
        });

        measurementCompleted = true;
      } catch (err) {
        if (signal.aborted) throw err;
        
        // Only count as lost if all retries fail
        if (retry === 1) {
          pingLost++;
          self.postMessage({
            type: "PING_FAILED_ITERATION",
            iteration: i + 1,
            pingSent,
            pingLost,
          });
        } else {
          // Brief delay before retry to avoid hammering the server
          await sleep(20);
        }
      }
    }

    // 80ms interval — prevents HTTP/2 stream queueing while keeping
    // the test responsive.
    await sleep(80);
  }

  // Final jitter with outlier filtering
  const finalJitter = calculateFilteredJitter(latencies, CONFIG.JITTER_OUTLIER_SIGMA);

  self.postMessage({
    type: "PING_COMPLETE",
    latencies,
    jitter: finalJitter,
    pingSent,
    pingLost,
    avgIcmpEquivalent: 0,
  });
}

/**
 * 2. Download Test Engine — Streaming Architecture
 *
 * Each parallel stream opens ONE long-lived connection to Cloudflare's __down
 * endpoint and reads data continuously across all phases. This maintains TCP
 * window state (congestion control, slow-start) across the entire test instead
 * of resetting it with fresh connections per phase.
 *
 * Phase timing is controlled by the main loop — streams don't know about phases.
 * Bytes received during each phase window are tracked separately for phase-specific
 * statistics.
 */
async function runDownloadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  _basePing: number,
  parallelStreams: number,
  dynamicWarmupMs: number,
  dynamicRampMs: number,
  _signal: AbortSignal,
  _networkType?: string,
) {
  const startTime = performance.now();
  let totalBytesDownloaded = 0;

  // Test-scoped abort — fires when test duration ends, stopping all streams and pings
  const testAbort = new AbortController();
  const testSignal = testAbort.signal;

  // Track loaded latency pings under download stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let loadedIcmpEstimate = 0;
  let dlPingSent = 0;
  let dlPingLost = 0;

  // Track loaded latency ping timestamps and values
  const pingLog: { time: number; latency: number }[] = [];

  // Sliding window samples for smooth instantaneous speed calculation
  const downloadHistory: { time: number; bytes: number }[] = [];

  // Collect all instantaneous speeds for percentile-based peak calculation
  const allInstantaneousSpeeds: number[] = [];

  // Phase tracking — boundaries defined by cumulative byte counts
  const totalWarmupMs = dynamicWarmupMs;
  const totalRampMs = dynamicRampMs;
  const totalMeasureMs = CONFIG.DOWNLOAD_MEASURE_MS;
  const totalPeakMs = CONFIG.DOWNLOAD_PEAK_MS;

  let warmupEndMs = totalWarmupMs;
  let rampEndMs = warmupEndMs + totalRampMs;
  let measureEndMs = rampEndMs + totalMeasureMs;
  let peakEndMs = measureEndMs + totalPeakMs;
  let totalTestMs = peakEndMs;

  let measurementStartTime: number | null = null;
  let measurementEndTime: number | null = null;
  let warmupStartBytes = 0;
  let warmupEndBytes = 0;
  let rampStartBytes = 0;
  let rampEndBytes = 0;
  let phase3StartBytes = 0;
  let phase3EndBytes = 0;
  let peakStartBytes = 0;
  let peakEndBytes = 0;

  // Background latency pinger under download stress.
  // Fire-and-forget pattern: send pings without awaiting response, so scheduling
  // is decoupled from connection pool starvation. This ensures consistent ping
  // counts even when 6 download streams saturate the HTTP/2 pool.
  // Adaptive interval: shorter on WiFi/fiber, longer on cellular to avoid self-congestion.
  const loadedPingInterval = getLoadedPingInterval(_networkType);
  let activePingTimeout: any = null;
  let nextPingTargetTime = startTime;
  const activePingControllers: AbortController[] = [];

  const scheduleNextPing = () => {
    if (!testSignal.aborted && performance.now() - startTime < totalTestMs) {
      nextPingTargetTime += loadedPingInterval;
      const delay = Math.max(0, nextPingTargetTime - performance.now());
      activePingTimeout = setTimeout(runPingLoop, delay);
    }
  };

  const runPingLoop = () => {
    if (testSignal.aborted || performance.now() - startTime >= totalTestMs) return;

    dlPingSent++;
    const pingStart = performance.now();

    // Per-ping abort controller with 3s timeout to prevent stuck fetches
    const pingCtrl = new AbortController();
    activePingControllers.push(pingCtrl);
    const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);

    fetch(buildDirectLatencyUrl(`loaded-dl-${Date.now()}`), { signal: pingCtrl.signal, cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          return res.status === 204 ? null : res.text().then(() => null);
        }
        dlPingLost++;
      })
      .then(() => {
        const lat = performance.now() - pingStart;
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = calculateMean(loadedLatencies);
        loadedJitter = calculateFilteredJitter(loadedLatencies, CONFIG.JITTER_OUTLIER_SIGMA);
        const offset = _networkType === "cellular" || _networkType?.startsWith("cellular-") ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;
        loadedIcmpEstimate = Math.max(0, loadedAvg - offset);
      })
      .catch(() => {
        if (!pingCtrl.signal.aborted) dlPingLost++;
      })
      .finally(() => {
        clearTimeout(pingTimeout);
        const idx = activePingControllers.indexOf(pingCtrl);
        if (idx !== -1) activePingControllers.splice(idx, 1);
      });

    scheduleNextPing();
  };

  runPingLoop();

  const downloadRequests: any[] = [];

  // Monitor progress on timer — calculates instantaneous speed from global byte counter
  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTime;

    // Record the current snapshot for sliding window
    downloadHistory.push({ time: now, bytes: totalBytesDownloaded });

    // Purge samples older than 1 second
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

    // Average speed: total bytes / total elapsed time
    const elapsedSinceStart = (now - startTime) / 1000;
    const avgSpeedBps = elapsedSinceStart > 0.1
      ? (totalBytesDownloaded * 8) / elapsedSinceStart
      : 0;

    // Collect instantaneous speeds during measurement phase (Phase 3) AND peak phase (Phase 4)
    // Excluding first 10% of measurement phase to avoid ramp artifacts
    const measureWindowStart = rampEndMs + (measureEndMs - rampEndMs) * 0.1;
    const inMeasurementOrPeak = elapsedMs >= measureWindowStart && elapsedMs < peakEndMs;
    if (inMeasurementOrPeak && instSpeedBps > 0) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    // Calculate peak as 95th percentile using Nearest Rank method
    let peakSpeed = 0;
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
      peakSpeed = sorted[p95Index];
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

  // --- Streaming download: one long-lived connection per stream ---
  // Each stream fetches a very large payload and reads continuously.
  // TCP state is maintained across the entire test duration.
  // Phase transitions are tracked by the time-based progress monitor above.
  // Per-stream bytes scale down with stream count to keep total data reasonable:
  // 1 stream = 500MB, 6 streams = ~85MB each (~500MB total).

  const perStreamBytes = Math.ceil((500 * 1024 * 1024) / parallelStreams);
  let streamCompleteCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const runStream = async (streamIndex: number): Promise<void> => {
    let streamBytesTotal = 0;

    // Retry loop for connection failures
    for (let attempt = 0; attempt <= CONFIG.MAX_CHUNK_RETRIES; attempt++) {
      if (testSignal.aborted || isCancelled) return;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Circuit breaker: too many consecutive failures, abort early
        self.postMessage({
          type: "ERROR",
          message: "Circuit breaker tripped: too many consecutive download failures",
        });
        return;
      }

      const requestTimestamp = Date.now();
      const streamStart = performance.now();

      try {
        // Direct to Cloudflare — no Worker proxy
        const url = `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=${perStreamBytes}&cb=${Date.now()}-${Math.random()}-${streamIndex}`;

        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: testSignal,
        });

        const headersReceived = performance.now();
        const connectLatency = headersReceived - streamStart;

        if (!response.body) {
          throw new Error("ReadableStream not supported on download body");
        }

        const reader = response.body.getReader();
        let bytesInThisRequest = 0;

        try {
          while (!testSignal.aborted && !isCancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytesInThisRequest += value.length;
              totalBytesDownloaded += value.length;
              streamBytesTotal += value.length;
            }
          }
        } finally {
          const streamEnd = performance.now();
          reader.cancel().catch(() => {});

          // Record this stream's contribution as a single request entry
          const totalStreamDuration = streamEnd - headersReceived;
          const bps = totalStreamDuration > 0
            ? (bytesInThisRequest * 8) / (totalStreamDuration / 1000)
            : 0;

          const requestPings = pingLog
            .filter((p) => p.time >= streamStart && p.time <= streamEnd)
            .map((p) => p.latency);

          downloadRequests.push({
            time: requestTimestamp,
            direction: "download",
            bytes: bytesInThisRequest,
            payloadSize: perStreamBytes,
            phaseSize: perStreamBytes,
            latency: connectLatency,
            bps,
            duration: totalStreamDuration,
            serverTime: -1,
            responseSize: bytesInThisRequest,
            loadedLatencies: requestPings,
          });
        }

        // Stream completed successfully
        consecutiveFailures = 0; // Reset on success
        break;
      } catch (err) {
        if (testSignal.aborted || isCancelled) return;
        consecutiveFailures++;
        if (attempt < CONFIG.MAX_CHUNK_RETRIES) {
          await sleep(CONFIG.CHUNK_RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    streamCompleteCount++;
  };

  // Launch all parallel streams — they run concurrently
  const streamPromises = Array.from({ length: parallelStreams }, (_, i) => runStream(i));

  // Track phase byte boundaries as streams accumulate data
  // We poll the global counter to detect phase transitions
  const trackPhaseTransitions = async () => {
    // Warmup starts at test beginning (0 bytes)
    warmupStartBytes = 0;

    while (!testSignal.aborted && !isCancelled) {
      await sleepWithAbort(50, testSignal);
      const elapsedMs = performance.now() - startTime;

      // Phase 1 → 2: warmup complete
      if (elapsedMs >= warmupEndMs && warmupEndBytes === 0) {
        warmupEndBytes = totalBytesDownloaded;
        rampStartBytes = totalBytesDownloaded;
      }

      // Phase 2 → 3: measurement starts
      if (elapsedMs >= rampEndMs && measurementStartTime === null) {
        measurementStartTime = performance.now();
        rampEndBytes = totalBytesDownloaded;
        phase3StartBytes = totalBytesDownloaded;
      }

      // Phase 3 → 4: measurement ends
      if (elapsedMs >= measureEndMs && measurementEndTime === null) {
        measurementEndTime = performance.now();
        phase3EndBytes = totalBytesDownloaded;
        peakStartBytes = totalBytesDownloaded;
      }

      // Phase 4 end: peak complete
      if (elapsedMs >= peakEndMs) {
        peakEndBytes = totalBytesDownloaded;
        break;
      }
    }
  };

  // Run phase tracker and streams concurrently
  // When phase tracker completes (test duration elapsed), abort all streams
  await Promise.all([
    trackPhaseTransitions().then(() => testAbort.abort()),
    Promise.all(streamPromises).catch(() => {}),
  ]);

  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);
  // Abort any in-flight loaded latency pings
  for (const ctrl of activePingControllers) ctrl.abort();
  activePingControllers.length = 0;

  // Synthesize per-phase request entries from streaming data.
  // The streaming architecture creates N raw entries (one per stream, all with
  // phaseSize=500MB). The UI bins expect per-phase categorization. We replace
  // the raw entries with synthetic per-phase entries using the byte boundaries
  // tracked during the test.
  const phaseEntries: any[] = [];
  const phaseBoundaries = [
    { name: "warmup", startBytes: warmupStartBytes, endBytes: warmupEndBytes, phaseSize: CONFIG.DOWNLOAD_PHASE_WARMUP_SIZE, durationMs: dynamicWarmupMs },
    { name: "ramp", startBytes: rampStartBytes, endBytes: rampEndBytes, phaseSize: CONFIG.DOWNLOAD_PHASE_RAMP_SIZE, durationMs: dynamicRampMs },
    { name: "measure", startBytes: phase3StartBytes, endBytes: phase3EndBytes, phaseSize: CONFIG.DOWNLOAD_PHASE_MEASURE_SIZE, durationMs: CONFIG.DOWNLOAD_MEASURE_MS },
    { name: "peak", startBytes: peakStartBytes, endBytes: peakEndBytes, phaseSize: CONFIG.DOWNLOAD_PHASE_PEAK_SIZE, durationMs: CONFIG.DOWNLOAD_PEAK_MS },
  ];

  for (const phase of phaseBoundaries) {
    const bytes = Math.max(0, phase.endBytes - phase.startBytes);
    const durationSec = phase.durationMs / 1000;
    const bps = durationSec > 0.1 && bytes > 0 ? (bytes * 8) / durationSec : 0;

    // Collect pings that fell within this phase's time window
    const phaseStartMs = phase.name === "warmup" ? startTime
      : phase.name === "ramp" ? startTime + dynamicWarmupMs
      : phase.name === "measure" ? startTime + dynamicWarmupMs + dynamicRampMs
      : startTime + dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS;
    const phaseEndMs = phaseStartMs + phase.durationMs;
    const phasePings = pingLog
      .filter((p) => p.time >= phaseStartMs && p.time <= phaseEndMs)
      .map((p) => p.latency);

    phaseEntries.push({
      time: Date.now(),
      direction: "download",
      bytes,
      payloadSize: phase.phaseSize,
      phaseSize: phase.phaseSize,
      latency: 0,
      bps,
      duration: phase.durationMs,
      serverTime: -1,
      responseSize: bytes,
      loadedLatencies: phasePings,
    });
  }

  // Use synthesized per-phase entries (fallback to raw stream entries if phases have no data)
  const hasPhaseData = phaseEntries.some((e) => e.bytes > 0);
  const finalRequests = hasPhaseData ? phaseEntries : downloadRequests;

  // Calculate final average speed using ONLY Phase 3 (measurement phase) data
  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null && measurementEndTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    const phase3ElapsedSec = (measurementEndTime - measurementStartTime) / 1000;
    finalAvgSpeedBps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec
      : 0;
  } else {
    // Fallback: use full test duration
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesDownloaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 95th percentile of instantaneous speeds
  // collected ONLY during measurement phase (Phase 3)
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    finalPeakSpeed = sorted[p95Index];
  }

  // Validate measurement reliability
  const completedRequests = downloadRequests.filter((r) => r.bytes > 0 && r.bps > 0);
  const reliable = completedRequests.length >= 1 && finalAvgSpeedBps > 0;

  self.postMessage({
    type: "DOWNLOAD_COMPLETE",
    totalBytes: totalBytesDownloaded,
    averageSpeed: finalAvgSpeedBps,
    peakSpeed: finalPeakSpeed,
    loadedLatency: loadedAvg,
    loadedJitter: loadedJitter,
    loadedIcmpEstimate,
    loadedLatencies: loadedLatencies,
    loadedPingSent: dlPingSent,
    loadedPingLost: dlPingLost,
    requests: finalRequests,
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
  _basePing: number,
  parallelStreams: number,
  _downloadSpeed: number,
  dynamicWarmupMs: number,
  dynamicRampMs: number,
  signal: AbortSignal,
  _networkType?: string,
) {
  const startTime = performance.now();
  let totalBytesUploaded = 0;
  let peakSpeed = 0;

  // Track loaded latency pings under upload stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let loadedIcmpEstimate = 0;
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

  // Track stable measurement start/end timestamps for Phase 3
  let measurementStartTime: number | null = null;
  let measurementEndTime: number | null = null;
  let measurementPhaseStarted = false;
  let peakPhaseActive = false;

  // Adaptive upload chunk sizing — scale minimum chunk based on download speed.
  // On slow mobile connections (500 Kbps), 256KB chunks take ~4s each, causing
  // phase timeouts before requests complete. Adaptive sizing targets ~500ms per
  // chunk at minimum, ensuring smooth progress and accurate measurement.
  const adaptiveMinChunk = getAdaptiveUploadMinChunk(_downloadSpeed);
  // Extend measurement duration for slow connections to ensure enough data
  // is transferred for statistically valid results
  const isSlowConnection = _downloadSpeed > 0 && _downloadSpeed < CONFIG.UPLOAD_SLOW_THRESHOLD;
  const effectiveMeasureMs = isSlowConnection ? CONFIG.UPLOAD_SLOW_MEASURE_MS : CONFIG.UPLOAD_MEASURE_MS;

  const durationMs = isSlowConnection
    ? CONFIG.UPLOAD_DURATION_MS + (effectiveMeasureMs - CONFIG.UPLOAD_MEASURE_MS)
    : CONFIG.UPLOAD_DURATION_MS;

  // Background latency pinger under upload load — fire-and-forget pattern.
  // Send pings without awaiting response to decouple scheduling from connection
  // pool contention, ensuring consistent ping counts.
  const loadedPingInterval = getLoadedPingInterval(_networkType);
  let activePingTimeout: any = null;
  let nextUploadPingTargetTime = startTime;
  const activePingControllers: AbortController[] = [];

  const scheduleNextPing = () => {
    if (!signal.aborted && performance.now() - startTime < durationMs) {
      nextUploadPingTargetTime += loadedPingInterval;
      const delay = Math.max(0, nextUploadPingTargetTime - performance.now());
      activePingTimeout = setTimeout(runPingLoop, delay);
    }
  };

  const runPingLoop = () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) return;

    ulPingSent++;
    const pingStart = performance.now();

    // Per-ping abort controller with 3s timeout to prevent stuck fetches
    const pingCtrl = new AbortController();
    activePingControllers.push(pingCtrl);
    const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);

    fetch(buildDirectLatencyUrl(`loaded-ul-${Date.now()}`), { signal: pingCtrl.signal, cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          return res.status === 204 ? null : res.text().then(() => null);
        }
        ulPingLost++;
      })
      .then(() => {
        const lat = performance.now() - pingStart;
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = calculateMean(loadedLatencies);
        loadedJitter = calculateFilteredJitter(loadedLatencies, CONFIG.JITTER_OUTLIER_SIGMA);
        const offset = _networkType === "cellular" || _networkType?.startsWith("cellular-") ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;
        loadedIcmpEstimate = Math.max(0, loadedAvg - offset);
      })
      .catch(() => {
        if (!pingCtrl.signal.aborted) ulPingLost++;
      })
      .finally(() => {
        clearTimeout(pingTimeout);
        const idx = activePingControllers.indexOf(pingCtrl);
        if (idx !== -1) activePingControllers.splice(idx, 1);
      });

    scheduleNextPing();
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

    // Collect instantaneous speeds during measurement phase (Phase 3) AND peak phase (Phase 4).
    if ((measurementPhaseStarted || peakPhaseActive) && instSpeedBps > 0) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    // Calculate peak as 95th percentile using Nearest Rank method.
    // Math.floor(n * 0.95) degenerates to maximum for small sample sizes.
    // Math.ceil(n * 0.95) - 1 is the correct Nearest Rank formula.
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
      peakSpeed = sorted[p95Index];
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
        let streamNextChunkSize = adaptiveMinChunk; // use adaptive minimum
        let uploadConsecutiveFailures = 0;
        const UPLOAD_MAX_CONSECUTIVE_FAILURES = 3;

        while (
          !signal.aborted &&
          !isCancelled &&
          !phaseAbortController.signal.aborted
        ) {
          const elapsedMs = performance.now() - phaseStart;
          if (elapsedMs >= phaseDuration) break;

          if (uploadConsecutiveFailures >= UPLOAD_MAX_CONSECUTIVE_FAILURES) {
            // Circuit breaker: too many consecutive upload failures
            break;
          }

          const currentChunkSize = streamNextChunkSize;

          // Send directly to Cloudflare's __up endpoint, bypassing our Worker
          // proxy. The Cloudflare speedtest SDK sends uploads directly from the
          // browser to speed.cloudflare.com/__up with no proxy.
          //
          // CORS constraint: the request MUST use a CORS-safelisted content
          // type to avoid a preflight OPTIONS request. Cloudflare's __up does
          // NOT respond to preflight requests (returns 400). The safelisted
          // types are: application/x-www-form-urlencoded, multipart/form-data,
          // text/plain. We use a string body which the browser sends as
          // text/plain;charset=UTF-8 — no preflight triggered.
          //
          // NOTE: POST request bodies are NEVER compressed by browsers.
          // Content-Encoding: gzip applies to responses, not requests.
          // We use random printable ASCII text (not "0".repeat) so the payload
          // is truly non-compressible, matching our website's claim.
          const url = `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__up?bytes=${currentChunkSize}&cb=${Date.now()}-${Math.random()}`;

          const chunkStart = performance.now();
          const requestTimestamp = Date.now();

          const fetchController = new AbortController();
          activeFetchControllers.push(fetchController);

          // Per-fetch timeout: abort if the request takes too long.
          // Prevents hanging requests on congested mobile networks
          // where carrier-grade NAT can silently drop connections.
          const fetchTimeout = setTimeout(() => fetchController.abort(), CONFIG.UPLOAD_FETCH_TIMEOUT_MS);

          try {
            if (firstByteTime === null) {
              firstByteTime = chunkStart;
            }

            const response = await fetch(url, {
              method: "POST",
              body: generateRandomText(currentChunkSize),
              signal: fetchController.signal,
            });

            // Measure upload completion when response headers arrive (fetch resolves).
            // fetch() resolves when the server sends back response headers, which
            // happens AFTER the server has fully received and stored the upload data.
            // We do NOT await response.text() here — that would add server processing
            // time + response download time to our measurement, inflating the result.
            const uploadCompleteTime = performance.now();

            // Drain response body in background to properly close the connection.
            // Fire-and-forget: this doesn't affect the timing measurement.
            response.text().catch(() => {});

            if (response.ok) {
              completedBytes += currentChunkSize;
              uploadConsecutiveFailures = 0; // Reset on success

              // Dynamically adjust chunk size based on measured speed.
              // Target ~500ms per chunk for accurate sizing on slow connections.
              // Dampening: limit change to ±30% per iteration to prevent oscillation
              // on variable-bandwidth networks (cellular handovers, congestion spikes).
              const chunkDuration = uploadCompleteTime - chunkStart;
              if (chunkDuration > 0) {
                const chunkSpeed = (currentChunkSize * 8) / (chunkDuration / 1000);
                streamSpeedEstimate = streamSpeedEstimate * 0.3 + chunkSpeed * 0.7;
                const targetDurationSec = 0.5;
                const rawNextChunk = Math.floor((streamSpeedEstimate * targetDurationSec) / 8);
                // Apply ±30% dampening to prevent oscillation
                const minDampened = Math.floor(streamNextChunkSize * 0.7);
                const maxDampened = Math.floor(streamNextChunkSize * 1.3);
                streamNextChunkSize = Math.max(minDampened, Math.min(maxDampened, rawNextChunk));
                streamNextChunkSize = Math.max(adaptiveMinChunk, Math.min(streamNextChunkSize, CONFIG.UPLOAD_MAX_CHUNK));
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
            }
          } catch (err: any) {
            // Don't record phase-completion aborts as failures.
            // When the phase timer fires, it aborts in-flight fetches
            // to transition to the next phase. This is expected behavior,
            // not a network failure. The same abort signal is used for
            // user cancellation (CANCEL), which IS a real interruption.
            const isPhaseAbort = phaseAbortController.signal.aborted && !isCancelled && !signal.aborted;
            const isFetchAbort = err?.name === "AbortError";
            if (isFetchAbort && isPhaseAbort) {
              // Phase ended normally — in-flight request was cleaned up.
              // Don't record as failure; the request was in progress when
              // the phase completed, which is expected on all connections.
            } else {
              // Actual failure: network error, timeout, or user cancellation
              uploadConsecutiveFailures++;
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
                error: isFetchAbort ? "cancelled" : (err?.message || "unknown"),
              });
            }
          } finally {
            clearTimeout(fetchTimeout);
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

  // Synchronization barrier: wait for in-flight TCP data to drain completely.
  // Event-based: wait until no new bytes arrive, ensuring Phase 2
  // data doesn't leak into Phase 3's measurement baseline.
  // Increased from 150ms to 250ms for slow connections where data drains slowly.
  {
    let lastByteCount = completedBytes;
    let stableMs = 0;
    while (stableMs < CONFIG.SYNC_BARRIER_STABLE_MS && !signal.aborted && !isCancelled) {
      await sleepWithAbort(CONFIG.SYNC_BARRIER_POLL_MS, signal);
      if (completedBytes === lastByteCount) {
        stableMs += CONFIG.SYNC_BARRIER_POLL_MS;
      } else {
        lastByteCount = completedBytes;
        stableMs = 0;
      }
    }
  }

  // Phase 3: main measurement - stable throughput
  // Use extended duration for slow connections to ensure enough data
  // is transferred for statistically valid results
  let phase3StartBytes = completedBytes;
  let phase3EndBytes = completedBytes;
  if (!signal.aborted && !isCancelled) {
    measurementStartTime = performance.now();
    phase3StartBytes = completedBytes;
    measurementPhaseStarted = true;
    await runUploadPhase(10 * 1024 * 1024, effectiveMeasureMs);
    measurementEndTime = performance.now();
    measurementPhaseStarted = false;
    phase3EndBytes = completedBytes;
  }

  // Phase 4: peak measurement - max throughput
  if (!signal.aborted && !isCancelled) {
    peakPhaseActive = true;
    await runUploadPhase(25 * 1024 * 1024, CONFIG.UPLOAD_PEAK_MS);
    peakPhaseActive = false;
  }

  // Clean up
  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);
  // Abort any in-flight loaded latency pings
  for (const ctrl of activePingControllers) ctrl.abort();
  activePingControllers.length = 0;

  // Use completedBytes directly
  totalBytesUploaded = completedBytes;

  // Calculate final average speed using ONLY Phase 3 (measurement phase) data.
  // Phase 4 uses oversized chunks that don't represent steady-state throughput.
  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null && measurementEndTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    // Use actual elapsed time, not CONFIG constant — phase may have been cut short
    // by abort controller or total duration limit, making the CONFIG value inaccurate.
    const phase3ElapsedSec = (measurementEndTime - measurementStartTime) / 1000;
    finalAvgSpeedBps = phase3ElapsedSec > 0.1 && phase3Bytes > 0
      ? (phase3Bytes * 8) / phase3ElapsedSec
      : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesUploaded * 8) / elapsedSec : 0;
  }

  // Calculate final peak as 95th percentile of instantaneous speeds
  // collected ONLY during measurement phase (Phase 3).
  // Using Nearest Rank method: ceil(n * 0.95) - 1
  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    finalPeakSpeed = sorted[p95Index];
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
    loadedIcmpEstimate,
    loadedLatencies: loadedLatencies,
    loadedPingSent: ulPingSent,
    loadedPingLost: ulPingLost,
    requests: uploadRequests,
    reliable,
  });
}

/**
 * 4. Dedicated Packet Loss Test Engine
 *
 * Sends N rapid pings to speed.cloudflare.com/__down?bytes=1 to measure
 * real network-level packet loss. Failures indicate genuine connectivity
 * issues (timeout, connection reset, DNS failure), not Worker execution errors.
 */
async function runPacketLossTest(
  _baseUrl: string,
  _region: string | undefined,
  _serverId: string | undefined,
  _clientLat: number,
  _clientLon: number,
  signal: AbortSignal,
  _networkType?: string,
) {
  const totalPings = CONFIG.PACKET_LOSS_PINGS;
  // Adaptive interval: shorter on cellular to detect burst loss patterns
  const intervalMs = getPacketLossInterval(_networkType);
  let sent = 0;
  let lost = 0;

  // 1. Warm-up — establish connection before loss measurement
  try {
    const warmupRes = await fetch(buildDirectLatencyUrl(`pl-warmup-${Date.now()}`), {
      method: "GET",
      cache: "no-store",
      signal,
    });
    if (warmupRes.status !== 204) {
      await warmupRes.text();
    }
  } catch (_) {
    // Warmup failure doesn't invalidate the test
  }

  // 2. Measure packet loss
  for (let i = 0; i < totalPings; i++) {
    if (isCancelled || signal.aborted) break;

    sent++;
    try {
      const res = await fetch(buildDirectLatencyUrl(`pl-${i}-${Date.now()}`), {
        method: "GET",
        cache: "no-store",
        signal,
      });

      if (res.ok) {
        if (res.status !== 204) {
          await res.text();
        }
      } else {
        // Any non-OK response from speed.cloudflare.com indicates a real issue
        lost++;
      }
    } catch (err: any) {
      // Network-level errors (timeout, connection reset, DNS failure)
      if (err.name === "AbortError" || isCancelled) {
        break;
      }
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
    serverErrors: 0,
    lossBreakdown: { timeout: 0, reset: 0, serverError: 0 },
  });
}
