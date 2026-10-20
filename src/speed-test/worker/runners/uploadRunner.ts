import { CONFIG } from "../../constants";
import {
  calculateMean,
  calculateFilteredJitter,
  getAdaptiveUploadMinChunk,
  generateRandomText,
  getLoadedPingInterval,
  sleepWithAbort,
} from "../../utils";

export interface UploadRunnerOptions {
  baseUrl?: string;
  region?: string;
  serverId?: string;
  clientLat?: number;
  clientLon?: number;
  basePing?: number;
  parallelStreams: number;
  downloadSpeed: number;
  dynamicWarmupMs: number;
  dynamicRampMs: number;
  networkType?: string;
  signal: AbortSignal;
  postMessage: (msg: any) => void;
  isCancelled: () => boolean;
}

/**
 * Upload Test Runner
 * Measures upload throughput using concurrent chunked uploads with adaptive sizing.
 */
export async function runUploadTest(options: UploadRunnerOptions): Promise<void> {
  const {
    parallelStreams,
    downloadSpeed,
    dynamicWarmupMs,
    dynamicRampMs,
    networkType,
    signal,
    postMessage,
    isCancelled,
  } = options;

  const startTime = performance.now();
  let totalBytesUploaded = 0;
  let peakSpeed = 0;

  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let loadedIcmpEstimate = 0;
  let ulPingSent = 0;
  let ulPingLost = 0;

  const pingLog: { time: number; latency: number }[] = [];
  const uploadHistory: { time: number; bytes: number }[] = [];
  let firstByteTime: number | null = null;
  const allInstantaneousSpeeds: number[] = [];
  let completedBytes = 0;

  let measurementStartTime: number | null = null;
  let measurementEndTime: number | null = null;
  let measurementPhaseStarted = false;
  let peakPhaseActive = false;

  const adaptiveMinChunk = getAdaptiveUploadMinChunk(downloadSpeed);
  const isSlowConnection = downloadSpeed > 0 && downloadSpeed < CONFIG.UPLOAD_SLOW_THRESHOLD;
  const effectiveMeasureMs = isSlowConnection
    ? CONFIG.UPLOAD_SLOW_MEASURE_MS
    : CONFIG.UPLOAD_MEASURE_MS;

  const durationMs = isSlowConnection
    ? CONFIG.UPLOAD_DURATION_MS + (effectiveMeasureMs - CONFIG.UPLOAD_MEASURE_MS)
    : CONFIG.UPLOAD_DURATION_MS;

  const loadedPingInterval = getLoadedPingInterval(networkType);
  let activePingTimeout: ReturnType<typeof setTimeout> | null = null;
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

    const pingCtrl = new AbortController();
    activePingControllers.push(pingCtrl);
    const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);

    fetch(
      `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=loaded-ul-${Date.now()}`,
      { signal: pingCtrl.signal, cache: "no-store" },
    )
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
        const offset =
          networkType === "cellular" || networkType?.startsWith("cellular-")
            ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS
            : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;
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

  const progressInterval = setInterval(() => {
    const now = performance.now();

    totalBytesUploaded = completedBytes;

    uploadHistory.push({
      time: now,
      bytes: totalBytesUploaded,
    });

    const windowStartLimit = now - 1000;
    while (uploadHistory.length > 0 && uploadHistory[0].time < windowStartLimit) {
      uploadHistory.shift();
    }

    let instSpeedBps = 0;
    if (uploadHistory.length >= 2) {
      const oldest = uploadHistory[0];
      const newest = uploadHistory[uploadHistory.length - 1];
      const timeDiffSec = (newest.time - oldest.time) / 1000;
      if (timeDiffSec > 0.05) {
        instSpeedBps = ((newest.bytes - oldest.bytes) * 8) / timeDiffSec;
      }
    }

    const elapsedSinceStart = (now - startTime) / 1000;
    const avgSpeedBps =
      elapsedSinceStart > 0.1 ? (totalBytesUploaded * 8) / elapsedSinceStart : 0;

    if ((measurementPhaseStarted || peakPhaseActive) && instSpeedBps > 0) {
      allInstantaneousSpeeds.push(instSpeedBps);
    }

    if (allInstantaneousSpeeds.length > 0) {
      const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
      const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
      peakSpeed = sorted[p95Index];
    }

    postMessage({
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
    return new Promise<void>((resolvePhase) => {
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();
      const activeFetchControllers: AbortController[] = [];

      const abortHandler = () => {
        phaseAbortController.abort();
        activeFetchControllers.forEach((c) => c.abort());
      };
      signal.addEventListener("abort", abortHandler);

      const runStream = async (): Promise<void> => {
        let streamSpeedEstimate = 1000 * 1000;
        let streamNextChunkSize = adaptiveMinChunk;
        let uploadConsecutiveFailures = 0;
        const UPLOAD_MAX_CONSECUTIVE_FAILURES = 3;

        while (
          !signal.aborted &&
          !isCancelled() &&
          !phaseAbortController.signal.aborted
        ) {
          const elapsedMs = performance.now() - phaseStart;
          if (elapsedMs >= phaseDuration) break;

          if (uploadConsecutiveFailures >= UPLOAD_MAX_CONSECUTIVE_FAILURES) {
            break;
          }

          const currentChunkSize = streamNextChunkSize;
          const url = `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__up?bytes=${currentChunkSize}&cb=${Date.now()}-${Math.random()}`;

          const chunkStart = performance.now();
          const requestTimestamp = Date.now();

          const fetchController = new AbortController();
          activeFetchControllers.push(fetchController);

          const fetchTimeout = setTimeout(
            () => fetchController.abort(),
            CONFIG.UPLOAD_FETCH_TIMEOUT_MS,
          );

          try {
            if (firstByteTime === null) {
              firstByteTime = chunkStart;
            }

            const response = await fetch(url, {
              method: "POST",
              body: generateRandomText(currentChunkSize),
              signal: fetchController.signal,
            });

            const uploadCompleteTime = performance.now();
            response.text().catch(() => {});

            if (response.ok) {
              completedBytes += currentChunkSize;
              uploadConsecutiveFailures = 0;

              const chunkDuration = uploadCompleteTime - chunkStart;
              if (chunkDuration > 0) {
                const chunkSpeed = (currentChunkSize * 8) / (chunkDuration / 1000);
                streamSpeedEstimate = streamSpeedEstimate * 0.3 + chunkSpeed * 0.7;
                const targetDurationSec = 0.5;
                const rawNextChunk = Math.floor((streamSpeedEstimate * targetDurationSec) / 8);
                const minDampened = Math.floor(streamNextChunkSize * 0.7);
                const maxDampened = Math.floor(streamNextChunkSize * 1.3);
                streamNextChunkSize = Math.max(minDampened, Math.min(maxDampened, rawNextChunk));
                streamNextChunkSize = Math.max(
                  adaptiveMinChunk,
                  Math.min(streamNextChunkSize, CONFIG.UPLOAD_MAX_CHUNK),
                );
              }

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
            const isPhaseAbort =
              phaseAbortController.signal.aborted && !isCancelled() && !signal.aborted;
            const isFetchAbort = err?.name === "AbortError";
            if (!isFetchAbort || !isPhaseAbort) {
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

      const streams = Array.from({ length: parallelStreams }).map(() => runStream());

      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
        activeFetchControllers.forEach((c) => c.abort());
      }, phaseDuration);

      Promise.all(streams)
        .catch(() => {})
        .finally(() => {
          clearTimeout(phaseTimer);
          signal.removeEventListener("abort", abortHandler);
          activeFetchControllers.forEach((c) => c.abort());
          resolvePhase();
        });
    });
  };

  await runUploadPhase(100 * 1024, dynamicWarmupMs);

  if (!signal.aborted && !isCancelled()) {
    await runUploadPhase(1 * 1024 * 1024, dynamicRampMs);
  }

  {
    let lastByteCount = completedBytes;
    let stableMs = 0;
    while (stableMs < CONFIG.SYNC_BARRIER_STABLE_MS && !signal.aborted && !isCancelled()) {
      await sleepWithAbort(CONFIG.SYNC_BARRIER_POLL_MS, signal);
      if (completedBytes === lastByteCount) {
        stableMs += CONFIG.SYNC_BARRIER_POLL_MS;
      } else {
        lastByteCount = completedBytes;
        stableMs = 0;
      }
    }
  }

  let phase3StartBytes = completedBytes;
  let phase3EndBytes = completedBytes;
  if (!signal.aborted && !isCancelled()) {
    measurementStartTime = performance.now();
    phase3StartBytes = completedBytes;
    measurementPhaseStarted = true;
    await runUploadPhase(10 * 1024 * 1024, effectiveMeasureMs);
    measurementEndTime = performance.now();
    measurementPhaseStarted = false;
    phase3EndBytes = completedBytes;
  }

  if (!signal.aborted && !isCancelled()) {
    peakPhaseActive = true;
    await runUploadPhase(25 * 1024 * 1024, CONFIG.UPLOAD_PEAK_MS);
    peakPhaseActive = false;
  }

  clearInterval(progressInterval);
  if (activePingTimeout) clearTimeout(activePingTimeout);
  for (const ctrl of activePingControllers) ctrl.abort();
  activePingControllers.length = 0;

  totalBytesUploaded = completedBytes;

  let finalAvgSpeedBps = 0;
  if (measurementStartTime !== null && measurementEndTime !== null) {
    const phase3Bytes = phase3EndBytes - phase3StartBytes;
    const phase3ElapsedSec = (measurementEndTime - measurementStartTime) / 1000;
    finalAvgSpeedBps =
      phase3ElapsedSec > 0.1 && phase3Bytes > 0 ? (phase3Bytes * 8) / phase3ElapsedSec : 0;
  } else {
    const elapsedSec = (performance.now() - startTime) / 1000;
    finalAvgSpeedBps = elapsedSec > 0.1 ? (totalBytesUploaded * 8) / elapsedSec : 0;
  }

  let finalPeakSpeed = 0;
  if (allInstantaneousSpeeds.length > 0) {
    const sorted = [...allInstantaneousSpeeds].sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    finalPeakSpeed = sorted[p95Index];
  }

  const completedUploadRequests = uploadRequests.filter((r) => r.bytes > 0 && r.bps > 0);
  const reliable = completedUploadRequests.length >= 3 && finalAvgSpeedBps > 0;

  postMessage({
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
