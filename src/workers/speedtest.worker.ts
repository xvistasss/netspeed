// Network Speed Test Worker Engine

let activeAbortController: AbortController | null = null;
let isCancelled = false;
let hostLatency = 0;

// Pre-generate a static random buffer (e.g., 8MB) to eliminate CPU payload generation overhead during the upload test
const UPLOAD_BUFFER_SIZE = 8 * 1024 * 1024; // 8MB
const preGeneratedUploadBuffer = new Uint8Array(UPLOAD_BUFFER_SIZE);
if (typeof self !== 'undefined' && self.crypto) {
  const maxQuota = 65536;
  for (let offset = 0; offset < UPLOAD_BUFFER_SIZE; offset += maxQuota) {
    const subarray = preGeneratedUploadBuffer.subarray(offset, Math.min(offset + maxQuota, UPLOAD_BUFFER_SIZE));
    self.crypto.getRandomValues(subarray);
  }
} else {
  for (let i = 0; i < UPLOAD_BUFFER_SIZE; i++) {
    preGeneratedUploadBuffer[i] = Math.floor(Math.random() * 256);
  }
}

const isLocalUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    );
  } catch (_) {
    return false;
  }
};

// Helper to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const signal = options.signal;
  
  const onAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', onAbort);
  }
  
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
};

// Listen for commands from the main thread
self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type === 'CANCEL') {
    isCancelled = true;
    if (activeAbortController) {
      activeAbortController.abort();
    }
    self.postMessage({ type: 'CANCELLED' });
    return;
  }

  isCancelled = false;
  activeAbortController = new AbortController();

  try {
    if (type === 'START_PING') {
      const { baseUrl, region, serverId, clientLat, clientLon } = e.data;
      await runPingTest(baseUrl, region, serverId, clientLat, clientLon, activeAbortController.signal);
    } else if (type === 'START_DOWNLOAD') {
      const { baseUrl, region, serverId, clientLat, clientLon, basePing, parallelStreams } = e.data;
      await runDownloadTest(baseUrl, region, serverId, clientLat, clientLon, basePing, parallelStreams || 4, activeAbortController.signal);
    } else if (type === 'START_UPLOAD') {
      const { baseUrl, region, serverId, clientLat, clientLon, basePing, parallelStreams } = e.data;
      await runUploadTest(baseUrl, region, serverId, clientLat, clientLon, basePing, parallelStreams || 4, activeAbortController.signal);
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || isCancelled) {
      self.postMessage({ type: 'ERROR', message: 'Test cancelled' });
    } else {
      self.postMessage({ type: 'ERROR', message: error.message || 'An error occurred during testing' });
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
  signal: AbortSignal
) {
  const iterations = 15;
  const latencies: number[] = [];
  let jitter = 0;
  let pingSent = 0;
  let pingLost = 0;

  // 1. Connection Warm-up Request (establishes TCP/TLS keep-alive)
  try {
    const warmupUrl = region
      ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&warmup=true&cb=warmup-${Date.now()}`
      : `${baseUrl}/ping?warmup=true&cb=warmup-${Date.now()}`;
    const startWarmup = performance.now();
    const res = await fetch(warmupUrl, {
      method: 'GET',
      cache: 'no-store',
      signal
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
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=${Date.now()}-${i}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=${Date.now()}-${i}`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        cache: 'no-store',
        signal
      }, 1500);

      if (!response.ok) {
        throw new Error('Ping request failed');
      }

      await response.text(); // Fully read response body

      const end = performance.now();
      const latency = end - start;
      latencies.push(latency);

      // Calculate Jitter (average absolute difference between consecutive tests)
      if (latencies.length > 1) {
        let sumDiffs = 0;
        for (let j = 1; j < latencies.length; j++) {
          sumDiffs += Math.abs(latencies[j] - latencies[j - 1]);
        }
        jitter = sumDiffs / (latencies.length - 1);
      }

      // Stream progress
      self.postMessage({
        type: 'PING_PROGRESS',
        iteration: i + 1,
        totalIterations: iterations,
        latency,
        jitter,
        latencies: [...latencies],
        pingSent,
        pingLost
      });

      // Brief sleep between pings to prevent queueing overhead
      await sleep(60);
    } catch (err) {
      if (signal.aborted) throw err;
      pingLost++;
      self.postMessage({
        type: 'PING_FAILED_ITERATION',
        iteration: i + 1,
        pingSent,
        pingLost
      });
    }
  }

  self.postMessage({ type: 'PING_COMPLETE', latencies, jitter, pingSent, pingLost });
}

/**
 * 2. Download Test Engine (Progressive sequential phases & concurrent streams)
 */
async function runDownloadTest(
  baseUrl: string,
  region: string | undefined,
  serverId: string | undefined,
  clientLat: number,
  clientLon: number,
  basePing: number,
  parallelStreams: number,
  signal: AbortSignal
) {
  const durationMs = 8000; // 8 seconds test window
  let estimatedRtt = 20;
  if (basePing > 0) {
    estimatedRtt = basePing;
  }
  const maxThroughputBps = (10 * 1024 * 1024) / (estimatedRtt / 1000);
  const shouldThrottle = region && region !== 'local-edge' && maxThroughputBps < 125 * 1024 * 1024;
  const useDirectCf = isLocalUrl(baseUrl) && !shouldThrottle;

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
  const speedSamples: { time: number; bytes: number }[] = [];
  let firstByteTime: number | null = null;
  let phaseStartTime = performance.now();

  // Background latency pinger under download load (recursive timeout to avoid socket queueing)
  let activePingTimeout: any = null;
  const runPingLoop = async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) return;

    dlPingSent++;
    const pingStart = performance.now();
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=loaded-dl-${Date.now()}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=loaded-dl-${Date.now()}`;
      const res = await fetchWithTimeout(url, { signal, cache: 'no-store' }, 1500);
      if (res.ok) {
        await res.text();
        const lat = performance.now() - pingStart;
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = loadedLatencies.reduce((a, b) => a + b, 0) / loadedLatencies.length;
        if (loadedLatencies.length > 1) {
          let sumDiffs = 0;
          for (let j = 1; j < loadedLatencies.length; j++) {
            sumDiffs += Math.abs(loadedLatencies[j] - loadedLatencies[j - 1]);
          }
          loadedJitter = sumDiffs / (loadedLatencies.length - 1);
        }
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

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsedSincePhaseStart = (now - phaseStartTime) / 1000;
    
    // Purge samples older than 1 second (1000ms)
    const windowStartLimit = now - 1000;
    while (speedSamples.length > 0 && speedSamples[0].time < windowStartLimit) {
      speedSamples.shift();
    }

    // Sum window bytes
    const windowBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0);

    // Calculate elapsed and transmission duration
    const elapsedSinceStart = (now - startTime) / 1000;
    const transmissionStartTime = firstByteTime !== null ? firstByteTime : startTime;
    const transmissionDurationSec = (now - transmissionStartTime) / 1000;

    const windowDurationSec = Math.min(elapsedSinceStart, 1.0); // cap window duration at 1s

    // Calculate speeds
    const instSpeedBps = windowDurationSec > 0.1 ? (windowBytes * 8) / windowDurationSec : 0;
    const avgSpeedBps = transmissionDurationSec > 0.1 ? (totalBytesDownloaded * 8) / transmissionDurationSec : 0;

    if (instSpeedBps > peakSpeed && elapsedSinceStart > 0.5 && elapsedSincePhaseStart > 0.4) {
      peakSpeed = instSpeedBps; // Capture peak speed (skipping initial transient spike of each phase)
    }

    self.postMessage({
      type: 'DOWNLOAD_PROGRESS',
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
      requests: [...downloadRequests]
    });
  }, 100);

  // Sequential Phase Runner Function
  const runDownloadPhase = (targetSize: number, phaseDuration: number, nominalSize: number) => {
    return new Promise<void>(async (resolvePhase) => {
      phaseStartTime = performance.now();
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();

      const abortHandler = () => {
        phaseAbortController.abort();
      };
      signal.addEventListener('abort', abortHandler);

      const runStream = async () => {
        while (performance.now() - phaseStart < phaseDuration && !phaseAbortController.signal.aborted && !isCancelled) {
          const chunkStart = performance.now();
          const requestTimestamp = Date.now();

          try {
            const url = useDirectCf
              ? `https://speed.cloudflare.com/__down?bytes=${targetSize}`
              : (region
                ? `${baseUrl}/download?size=${targetSize}&region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
                : `${baseUrl}/download?size=${targetSize}&cb=${Date.now()}-${Math.random()}`);

            const response = await fetch(url, {
              method: 'GET',
              cache: 'no-store',
              headers: useDirectCf ? undefined : {
                'Cache-Control': 'no-store, no-cache'
              },
              signal: phaseAbortController.signal
            });

            const headersReceived = performance.now();
            const latency = headersReceived - chunkStart;

            if (!response.body) {
              throw new Error('ReadableStream not supported on download body');
            }

            const reader = response.body.getReader();
            let bytesReceived = 0;
            let chunkEnd = performance.now();

            try {
              while (performance.now() - phaseStart < phaseDuration && !phaseAbortController.signal.aborted && !isCancelled) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  if (firstByteTime === null) {
                    firstByteTime = headersReceived;
                  }
                  bytesReceived += value.length;
                  totalBytesDownloaded += value.length;
                  speedSamples.push({ time: performance.now(), bytes: value.length });
                }
              }
            } finally {
              chunkEnd = performance.now();
              reader.cancel().catch(() => {});
              
              if (bytesReceived > 0) {
                const chunkDuration = chunkEnd - headersReceived; // Use headersReceived for transfer duration
                const bps = chunkDuration > 0 ? (bytesReceived * 8) / (chunkDuration / 1000) : 0;

                const requestPings = pingLog
                  .filter(p => p.time >= chunkStart && p.time <= chunkEnd)
                  .map(p => p.latency);

                downloadRequests.push({
                  time: requestTimestamp,
                  direction: 'download',
                  bytes: bytesReceived,
                  payloadSize: targetSize,
                  phaseSize: nominalSize,
                  latency,
                  bps,
                  duration: chunkDuration,
                  serverTime: -1,
                  responseSize: bytesReceived,
                  loadedLatencies: requestPings
                });
              }
            }

          } catch (err) {
            if (phaseAbortController.signal.aborted || isCancelled) break;
            await sleep(50);
          }
        }
      };

      // Launch parallel streams
      const streams = Array.from({ length: parallelStreams }).map(() => runStream());

      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
      }, phaseDuration);

      await Promise.all(streams).catch(() => {});
      clearTimeout(phaseTimer);
      signal.removeEventListener('abort', abortHandler);
      resolvePhase();
    });
  };

  // Run the sequential payload size phases
  const phases = [
    { size: 100 * 1024, duration: 1500 },
    { size: 1 * 1024 * 1024, duration: 2000 },
    { size: 10 * 1024 * 1024, duration: 2500 },
    { size: 25 * 1024 * 1024, duration: 2000 }
  ];

  let totalWallClockDurationMs = 0;
  for (const phase of phases) {
    if (isCancelled || signal.aborted) break;
    const phaseStart = performance.now();
    await runDownloadPhase(phase.size, phase.duration, phase.size);
    totalWallClockDurationMs += (performance.now() - phaseStart);
  }

  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  const finalTime = performance.now();
  const transmissionStartTime = firstByteTime !== null ? firstByteTime : startTime;
  const totalTransmissionDurationMs = finalTime - transmissionStartTime;

  const finalAvgSpeedBps = totalTransmissionDurationMs > 0
    ? (totalBytesDownloaded * 8) / (totalTransmissionDurationMs / 1000)
    : 0;

  self.postMessage({
    type: 'DOWNLOAD_COMPLETE',
    totalBytes: totalBytesDownloaded,
    averageSpeed: finalAvgSpeedBps,
    peakSpeed,
    loadedLatency: loadedAvg,
    loadedJitter: loadedJitter,
    loadedLatencies: loadedLatencies,
    loadedPingSent: dlPingSent,
    loadedPingLost: dlPingLost,
    requests: downloadRequests
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
  signal: AbortSignal
) {
  const durationMs = 8000; // 8 seconds test window
  let estimatedRtt = 20;
  if (basePing > 0) {
    estimatedRtt = basePing;
  }
  const maxThroughputBps = (10 * 1024 * 1024) / (estimatedRtt / 1000);
  const shouldThrottle = region && region !== 'local-edge' && maxThroughputBps < 125 * 1024 * 1024;
  const useDirectCf = isLocalUrl(baseUrl) && !shouldThrottle;

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
  const speedSamples: { time: number; bytes: number }[] = [];
  let firstByteTime: number | null = null;
  let phaseStartTime = performance.now();

  // Background latency pinger under upload load (recursive timeout to avoid socket queueing)
  let activePingTimeout: any = null;
  const runPingLoop = async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) return;

    ulPingSent++;
    const pingStart = performance.now();
    try {
      const url = region
        ? `${baseUrl}/ping?region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&hostLatency=${hostLatency}&cb=loaded-ul-${Date.now()}`
        : `${baseUrl}/ping?hostLatency=${hostLatency}&cb=loaded-ul-${Date.now()}`;
      const res = await fetchWithTimeout(url, { signal, cache: 'no-store' }, 1500);
      if (res.ok) {
        await res.text();
        const lat = performance.now() - pingStart;
        loadedLatencies.push(lat);
        pingLog.push({ time: pingStart, latency: lat });

        loadedAvg = loadedLatencies.reduce((a, b) => a + b, 0) / loadedLatencies.length;
        if (loadedLatencies.length > 1) {
          let sumDiffs = 0;
          for (let j = 1; j < loadedLatencies.length; j++) {
            sumDiffs += Math.abs(loadedLatencies[j] - loadedLatencies[j - 1]);
          }
          loadedJitter = sumDiffs / (loadedLatencies.length - 1);
        }
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
    const elapsedSincePhaseStart = (now - phaseStartTime) / 1000;
    
    // Purge samples older than 1 second (1000ms)
    const windowStartLimit = now - 1000;
    while (speedSamples.length > 0 && speedSamples[0].time < windowStartLimit) {
      speedSamples.shift();
    }

    // Sum window bytes
    const windowBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0);

    // Calculate elapsed and transmission duration
    const elapsedSinceStart = (now - startTime) / 1000;
    const transmissionStartTime = firstByteTime !== null ? firstByteTime : startTime;
    const transmissionDurationSec = (now - transmissionStartTime) / 1000;

    const windowDurationSec = Math.min(elapsedSinceStart, 1.0); // cap window duration at 1s

    // Calculate speeds
    const instSpeedBps = windowDurationSec > 0.1 ? (windowBytes * 8) / windowDurationSec : 0;
    const avgSpeedBps = transmissionDurationSec > 0.1 ? (totalBytesUploaded * 8) / transmissionDurationSec : 0;

    if (instSpeedBps > peakSpeed && elapsedSinceStart > 0.5 && elapsedSincePhaseStart > 0.4) {
      peakSpeed = instSpeedBps; // Capture peak speed (skipping initial transient spike of each phase)
    }

    self.postMessage({
      type: 'UPLOAD_PROGRESS',
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
      requests: [...uploadRequests]
    });
  }, 100);

  // Sequential Phase Runner Function
  const runUploadPhase = (targetSize: number, phaseDuration: number, nominalSize: number) => {
    return new Promise<void>(async (resolvePhase) => {
      phaseStartTime = performance.now();
      const phaseStart = performance.now();
      const phaseAbortController = new AbortController();
      const activeXhrs: XMLHttpRequest[] = [];

      const abortHandler = () => {
        phaseAbortController.abort();
        [...activeXhrs].forEach(x => x.abort());
      };
      signal.addEventListener('abort', abortHandler);

      // Slice from the pre-generated static high-entropy buffer to avoid CPU overhead
      let uploadChunk: any;
      if (targetSize <= UPLOAD_BUFFER_SIZE) {
        const offset = Math.floor(Math.random() * (UPLOAD_BUFFER_SIZE - targetSize));
        uploadChunk = preGeneratedUploadBuffer.subarray(offset, offset + targetSize);
      } else {
        // Fallback if targetSize is larger than UPLOAD_BUFFER_SIZE
        uploadChunk = new Uint8Array(targetSize);
        for (let offset = 0; offset < targetSize; offset += UPLOAD_BUFFER_SIZE) {
          const copyLen = Math.min(UPLOAD_BUFFER_SIZE, targetSize - offset);
          uploadChunk.set(preGeneratedUploadBuffer.subarray(0, copyLen), offset);
        }
      }

      const runStream = () => {
        return new Promise<void>((resolveStream) => {
          if (performance.now() - phaseStart >= phaseDuration || phaseAbortController.signal.aborted || isCancelled) {
            resolveStream();
            return;
          }

          if (useDirectCf) {
            const chunkStart = performance.now();
            const requestTimestamp = Date.now();
            const blob = new Blob([uploadChunk], { type: 'text/plain' });

            fetch('https://speed.cloudflare.com/__up', {
              method: 'POST',
              body: blob,
              signal: phaseAbortController.signal
            })
            .then(async (response) => {
              if (response.ok) {
                await response.text();
                const chunkEnd = performance.now();
                const duration = chunkEnd - chunkStart;

                if (firstByteTime === null) {
                  firstByteTime = performance.now();
                }
                totalBytesUploaded += targetSize;
                speedSamples.push({ time: chunkEnd, bytes: targetSize });

                const bps = duration > 0 ? (targetSize * 8) / (duration / 1000) : 0;
                const requestPings = pingLog
                  .filter(p => p.time >= chunkStart && p.time <= chunkEnd)
                  .map(p => p.latency);

                uploadRequests.push({
                  time: requestTimestamp,
                  direction: 'upload',
                  bytes: targetSize,
                  payloadSize: targetSize,
                  phaseSize: nominalSize,
                  latency: 0,
                  bps,
                  duration,
                  serverTime: -1,
                  responseSize: 0,
                  loadedLatencies: requestPings
                });

                runStream().then(resolveStream);
              } else {
                resolveStream();
              }
            })
            .catch(() => {
              resolveStream();
            });
            return;
          }

          const xhr = new XMLHttpRequest();
          activeXhrs.push(xhr);

          const url = useDirectCf
            ? `https://speed.cloudflare.com/__up`
            : (region
              ? `${baseUrl}/upload?region=${region}&serverId=${serverId || ''}&clientLat=${clientLat}&clientLon=${clientLon}&basePing=${basePing}&cb=${Date.now()}-${Math.random()}`
              : `${baseUrl}/upload?cb=${Date.now()}-${Math.random()}`);

          xhr.open('POST', url, true);
          if (useDirectCf) {
            xhr.setRequestHeader('Content-Type', 'text/plain');
          } else {
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('Cache-Control', 'no-store, no-cache');
          }

          const chunkStart = performance.now();
          const requestTimestamp = Date.now();
          let lastLoaded = 0;
          let recorded = false;

          const recordStats = (completed: boolean) => {
            if (recorded) return;
            recorded = true;

            const chunkEnd = performance.now();
            const duration = chunkEnd - chunkStart;
            const bytesSent = lastLoaded;
            const bps = duration > 0 ? (bytesSent * 8) / (duration / 1000) : 0;

            const requestPings = pingLog
              .filter(p => p.time >= chunkStart && p.time <= chunkEnd)
              .map(p => p.latency);

            uploadRequests.push({
              time: requestTimestamp,
              direction: 'upload',
              bytes: bytesSent,
              payloadSize: targetSize,
              phaseSize: nominalSize,
              latency: 0,
              bps,
              duration,
              serverTime: -1,
              responseSize: completed ? xhr.responseText.length : 0,
              loadedLatencies: requestPings
            });
          };

          xhr.upload.addEventListener('progress', (event) => {
            if (event.loaded > lastLoaded) {
              if (firstByteTime === null) {
                firstByteTime = performance.now();
              }
              const delta = event.loaded - lastLoaded;
              totalBytesUploaded += delta;
              lastLoaded = event.loaded;
              speedSamples.push({ time: performance.now(), bytes: delta });
            }
          });

          xhr.onload = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);

            if (xhr.status === 200) {
              const remainingBytes = targetSize - lastLoaded;
              if (remainingBytes > 0) {
                totalBytesUploaded += remainingBytes;
                lastLoaded = targetSize;
                speedSamples.push({ time: performance.now(), bytes: remainingBytes });
              }
              recordStats(true);
              runStream().then(resolveStream);
            } else {
              recordStats(false);
              resolveStream();
            }
          };

          xhr.onerror = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);
            recordStats(false);
            resolveStream();
          };

          xhr.onabort = () => {
            const idx = activeXhrs.indexOf(xhr);
            if (idx > -1) activeXhrs.splice(idx, 1);
            recordStats(false);
            resolveStream();
          };

          if (useDirectCf) {
            xhr.send(new Blob([uploadChunk], { type: 'text/plain' }));
          } else {
            xhr.send(uploadChunk.buffer);
          }
        });
      };

      // Launch parallel streams
      const streams = Array.from({ length: parallelStreams }).map(() => runStream());

      const phaseTimer = setTimeout(() => {
        phaseAbortController.abort();
        [...activeXhrs].forEach(x => x.abort());
      }, phaseDuration);

      await Promise.all(streams).catch(() => {});
      clearTimeout(phaseTimer);
      signal.removeEventListener('abort', abortHandler);
      [...activeXhrs].forEach(x => x.abort());
      resolvePhase();
    });
  };

  // Run the sequential payload size phases
  const phases = [
    { size: 100 * 1024, duration: 1500 },
    { size: 1 * 1024 * 1024, duration: 2000 },
    { size: 10 * 1024 * 1024, duration: 2500 },
    { size: 25 * 1024 * 1024, duration: 2000 }
  ];

  let totalWallClockDurationMs = 0;
  for (let i = 0; i < phases.length; i++) {
    if (isCancelled || signal.aborted) break;
    const phase = phases[i];

    let targetSize = phase.size;
    if (i > 0 && totalWallClockDurationMs > 0 && totalBytesUploaded > 0) {
      // Calculate current upload speed in bytes per second
      const currentBps = totalBytesUploaded / (totalWallClockDurationMs / 1000);
      // We want each chunk to upload in at most 1.0 second to ensure multiple completions per phase
      const maxRecommendedSize = currentBps * 1.0;
      if (targetSize > maxRecommendedSize) {
        // Cap the target size, rounded to nearest 100KB, with a minimum floor of 100KB
        targetSize = Math.round(maxRecommendedSize / (100 * 1024)) * 100 * 1024;
        targetSize = Math.max(100 * 1024, targetSize);
      }
    }

    const phaseStart = performance.now();
    await runUploadPhase(targetSize, phase.duration, phase.size);
    totalWallClockDurationMs += (performance.now() - phaseStart);
  }

  // Clean up
  clearInterval(progressInterval);
  clearTimeout(activePingTimeout);

  const finalTime = performance.now();
  const transmissionStartTime = firstByteTime !== null ? firstByteTime : startTime;
  const totalTransmissionDurationMs = finalTime - transmissionStartTime;

  const finalAvgSpeedBps = totalTransmissionDurationMs > 0
    ? (totalBytesUploaded * 8) / (totalTransmissionDurationMs / 1000)
    : 0;

  self.postMessage({
    type: 'UPLOAD_COMPLETE',
    totalBytes: totalBytesUploaded,
    averageSpeed: finalAvgSpeedBps,
    peakSpeed,
    loadedLatency: loadedAvg,
    loadedJitter: loadedJitter,
    loadedLatencies: loadedLatencies,
    loadedPingSent: ulPingSent,
    loadedPingLost: ulPingLost,
    requests: uploadRequests
  });
}

