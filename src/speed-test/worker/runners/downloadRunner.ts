import { CONFIG } from "../../constants";
import {
  calculateMean,
  calculateFilteredJitter,
  getLoadedPingInterval,
  sleep,
  sleepWithAbort,
} from "../../utils";

export interface DownloadRunnerOptions {
  baseUrl?: string;
  region?: string;
  serverId?: string;
  clientLat?: number;
  clientLon?: number;
  basePing?: number;
  parallelStreams: number;
  dynamicWarmupMs: number;
  dynamicRampMs: number;
  networkType?: string;
  signal: AbortSignal;
  postMessage: (msg: any) => void;
  isCancelled: () => boolean;
}

/**
 * Download Test Runner - Streaming Architecture
 * Maintains TCP window state across continuous streaming connections.
 */
export async function runDownloadTest(options: DownloadRunnerOptions): Promise<void> {
  const {
    parallelStreams,
    dynamicWarmupMs,
    dynamicRampMs,
    networkType,
    postMessage,
    isCancelled,
  } = options;

  const startTime = performance.now();
  let totalBytesDownloaded = 0;

  const testAbort = new AbortController();
  const testSignal = testAbort.signal;

  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let loadedIcmpEstimate = 0;
  let dlPingSent = 0;
  let dlPingLost = 0;

  const pingLog: { time: number; latency: number }[] = [];
  const downloadHistory: { time: number; bytes: number }[] = [];
  const allInstantaneousSpeeds: number[] = [];

  const totalWarmupMs = dynamicWarmupMs;
  const totalRampMs = dynamicRampMs;
  const totalMeasureMs = CONFIG.DOWNLOAD_MEASURE_MS;
  const totalPeakMs = CONFIG.DOWNLOAD_PEAK_MS;

  const warmupEndMs = totalWarmupMs;
  const rampEndMs = warmupEndMs + totalRampMs;
  const measureEndMs = rampEndMs + totalMeasureMs;
  const peakEndMs = measureEndMs + totalPeakMs;
  const totalTestMs = peakEndMs;

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

  const loadedPingInterval = getLoadedPingInterval(networkType);
  let activePingTimeout: ReturnType<typeof setTimeout> | null = null;
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

    const pingCtrl = new AbortController();
    activePingControllers.push(pingCtrl);
    const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);

    fetch(
      `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=loaded-dl-${Date.now()}`,
      { signal: pingCtrl.signal, cache: "no-store" },
    )
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
        const offset =
          networkType === "cellular" || networkType?.startsWith("cellular-")
            ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS
            : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;
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

  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTime;

    downloadHistory.push({ time: now, bytes: totalBytesDownloaded });

    const windowStartLimit = now - 1000;
    while (downloadHistory.length > 0 && downloadHistory[0].time < windowStartLimit) {
      downloadHistory.shift();
    }

    let instSpeedBps = 0;
    if (downloadHistory.length >= 2) {
      const oldest = downloadHistory[0];
      const newest = downloadHistory[downloadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    const elapsedSinceStart = (now - startTime) / 1000;
    const avgSpeedBps =
      elapsedSinceStart > 0.1 ? (totalBytesDownloaded * 8) / elapsedSinceStart : 0;

    const measureWindowStart = rampEndMs + (measureEndMs - rampEndMs) * 0.1;
    const inMeasurementOrPeak = elapsedMs >= measureWindowStart && elapsedMs < peakEndMs;
    if (inMeasurementOrPeak && instSpeedBps > 0) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    let peakSpeed = 0;
    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
      peakSpeed = sorted[p95Index];
    }

    postMessage({
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

  const perStreamBytes = Math.ceil((500 * 1024 * 1024) / parallelStreams);
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const runStream = async (streamIndex: number): Promise<void> => {
    for (let attempt = 0; attempt <= CONFIG.MAX_CHUNK_RETRIES; attempt++) {
      if (testSignal.aborted || isCancelled()) return;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        postMessage({
          type: "ERROR",
          message: "Circuit breaker tripped: too many consecutive download failures",
        });
        return;
      }

      const requestTimestamp = Date.now();
      const streamStart = performance.now();

      try {
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
          while (!testSignal.aborted && !isCancelled()) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytesInThisRequest += value.length;
              totalBytesDownloaded += value.length;
            }
          }
        } finally {
          const streamEnd = performance.now();
          reader.cancel().catch(() => {});

          const totalStreamDuration = streamEnd - headersReceived;
          const bps =
            totalStreamDuration > 0
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

        consecutiveFailures = 0;
        break;
      } catch (err) {
        if (testSignal.aborted || isCancelled()) return;
        consecutiveFailures++;
        if (attempt < CONFIG.MAX_CHUNK_RETRIES) {
          await sleep(CONFIG.CHUNK_RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
  };

  const streamPromises = Array.from({ length: parallelStreams }, (_, i) => runStream(i));

  const trackPhaseTransitions = async () => {
    warmupStartBytes = 0;

    while (!testSignal.aborted && !isCancelled()) {
      await sleepWithAbort(50, testSignal);
      const elapsedMs = performance.now() - startTime;

      if (elapsedMs >= warmupEndMs && warmupEndBytes === 0) {
        warmupEndBytes = totalBytesDownloaded;
        rampStartBytes = totalBytesDownloaded;
      }

      if (elapsedMs >= rampEndMs && measurementStartTime === null) {
        measurementStartTime = performance.now();
        rampEndBytes = totalBytesDownloaded;
        phase3StartBytes = totalBytesDownloaded;
      }

      if (elapsedMs >= measureEndMs && measurementEndTime === null) {
        measurementEndTime = performance.now();
        phase3EndBytes = totalBytesDownloaded;
        peakStartBytes = totalBytesDownloaded;
      }

      if (elapsedMs >= peakEndMs) {
        peakEndBytes = totalBytesDownloaded;
        break;
      }
    }
  };

  await Promise.all([
    trackPhaseTransitions().then(() => testAbort.abort()),
    Promise.all(streamPromises).catch(() => {}),
  ]);

  clearInterval(progressInterval);
  if (activePingTimeout) clearTimeout(activePingTimeout);
  for (const ctrl of activePingControllers) ctrl.abort();
  activePingControllers.length = 0;

  const phaseEntries: any[] = [];
  const phaseBoundaries = [
    {
      id: "warmup",
      name: "Warmup (TCP Slow-Start)",
      startBytes: warmupStartBytes,
      endBytes: warmupEndBytes,
      phaseSize: CONFIG.DOWNLOAD_PHASE_WARMUP_SIZE,
      durationMs: dynamicWarmupMs,
    },
    {
      id: "ramp",
      name: "Ramp-Up (Window Expansion)",
      startBytes: rampStartBytes,
      endBytes: rampEndBytes,
      phaseSize: CONFIG.DOWNLOAD_PHASE_RAMP_SIZE,
      durationMs: dynamicRampMs,
    },
    {
      id: "measure",
      name: "Sustained (Steady-State)",
      startBytes: phase3StartBytes,
      endBytes: phase3EndBytes,
      phaseSize: CONFIG.DOWNLOAD_PHASE_MEASURE_SIZE,
      durationMs: CONFIG.DOWNLOAD_MEASURE_MS,
    },
    {
      id: "peak",
      name: "Peak Burst",
      startBytes: peakStartBytes,
      endBytes: peakEndBytes,
      phaseSize: CONFIG.DOWNLOAD_PHASE_PEAK_SIZE,
      durationMs: CONFIG.DOWNLOAD_PEAK_MS,
    },
  ];

  for (const phase of phaseBoundaries) {
    const bytes = Math.max(0, phase.endBytes - phase.startBytes);
    const durationSec = phase.durationMs / 1000;
    const bps = durationSec > 0.1 && bytes > 0 ? (bytes * 8) / durationSec : 0;

    const phaseStartMs =
      phase.id === "warmup"
        ? startTime
        : phase.id === "ramp"
          ? startTime + dynamicWarmupMs
          : phase.id === "measure"
            ? startTime + dynamicWarmupMs + dynamicRampMs
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
      phaseName: phase.name,
      latency: 0,
      bps,
      duration: phase.durationMs,
      serverTime: -1,
      responseSize: bytes,
      loadedLatencies: phasePings,
    });
  }

  const hasPhaseData = phaseEntries.some((e) => e.bytes > 0);
  const finalRequests = hasPhaseData ? phaseEntries : downloadRequests;

  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null) {
    const activeBytes = Math.max(
      0,
      peakEndBytes > phase3StartBytes ? peakEndBytes - phase3StartBytes : phase3EndBytes - phase3StartBytes,
    );
    const activeEndTime =
      measurementEndTime !== null
        ? peakEndBytes > phase3EndBytes
          ? performance.now()
          : measurementEndTime
        : performance.now();
    const activeElapsedSec = (activeEndTime - measurementStartTime) / 1000;
    finalAvgSpeedBps =
      activeElapsedSec > 0.1 && activeBytes > 0 ? (activeBytes * 8) / activeElapsedSec : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesDownloaded * 8) / elapsedSec : 0;
  }

  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    finalPeakSpeed = sorted[p95Index];
  }

  const completedRequests = downloadRequests.filter((r) => r.bytes > 0 && r.bps > 0);
  const reliable = completedRequests.length >= 1 && finalAvgSpeedBps > 0;

  postMessage({
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
