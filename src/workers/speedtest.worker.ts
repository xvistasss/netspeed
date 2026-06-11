// Network Speed Test Worker Engine

let activeAbortController: AbortController | null = null;
let isCancelled = false;

// Helper to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
      const { baseUrl, region } = e.data;
      await runPingTest(baseUrl, region, activeAbortController.signal);
    } else if (type === 'START_DOWNLOAD') {
      const { baseUrl, region, parallelStreams } = e.data;
      await runDownloadTest(baseUrl, region, parallelStreams || 4, activeAbortController.signal);
    } else if (type === 'START_UPLOAD') {
      const { baseUrl, region, parallelStreams } = e.data;
      await runUploadTest(baseUrl, region, parallelStreams || 4, activeAbortController.signal);
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
async function runPingTest(baseUrl: string, region: string | undefined, signal: AbortSignal) {
  const iterations = 15;
  const latencies: number[] = [];
  let jitter = 0;
  let pingSent = 0;
  let pingLost = 0;

  for (let i = 0; i < iterations; i++) {
    if (isCancelled || signal.aborted) break;

    pingSent++;
    const start = performance.now();
    try {
      const url = region 
        ? `${baseUrl}/ping?region=${region}&cb=${Date.now()}-${i}` 
        : `${baseUrl}/ping?cb=${Date.now()}-${i}`;
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache'
        },
        signal
      });
      
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
 * 2. Download Test Engine (Progressive sizing & concurrent streams)
 */
async function runDownloadTest(baseUrl: string, region: string | undefined, parallelStreams: number, signal: AbortSignal) {
  const durationMs = 8000; // 8 seconds test window
  const startTime = performance.now();
  let totalBytesDownloaded = 0;
  let peakSpeed = 0;
  let activeFetches = 0;

  // Track progress data for reporting
  let lastReportTime = startTime;
  let lastReportBytes = 0;

  // Track loaded latency pings under download stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let dlPingSent = 0;
  let dlPingLost = 0;

  // Track loaded latency ping timestamps and values
  const pingLog: { time: number; latency: number }[] = [];

  // Background latency pinger under download load
  const pingInterval = setInterval(async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) {
      clearInterval(pingInterval);
      return;
    }
    dlPingSent++;
    const pingStart = performance.now();
    try {
      const url = region 
        ? `${baseUrl}/ping?region=${region}&cb=loaded-dl-${Date.now()}` 
        : `${baseUrl}/ping?cb=loaded-dl-${Date.now()}`;
      const res = await fetch(url, { signal, cache: 'no-store' });
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
  }, 800); // Ping every 800ms

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;

    if (elapsed >= durationMs / 1000 || signal.aborted) {
      clearInterval(progressInterval);
      clearInterval(pingInterval);
      return;
    }

    const intervalSec = (now - lastReportTime) / 1000;
    const intervalBytes = totalBytesDownloaded - lastReportBytes;
    
    // Calculate speeds
    const instSpeedBps = intervalSec > 0 ? (intervalBytes * 8) / intervalSec : 0;
    const avgSpeedBps = elapsed > 0 ? (totalBytesDownloaded * 8) / elapsed : 0;
    
    if (instSpeedBps > peakSpeed && elapsed > 0.5) {
      peakSpeed = instSpeedBps; // Capture peak speed (skipping initial transient spike)
    }

    lastReportTime = now;
    lastReportBytes = totalBytesDownloaded;

    self.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      elapsedTime: elapsed,
      totalBytes: totalBytesDownloaded,
      instantaneousSpeed: instSpeedBps,
      averageSpeed: avgSpeedBps,
      peakSpeed,
      loadedLatency: loadedAvg,
      loadedJitter: loadedJitter
    });
  }, 100);

  const downloadRequests: any[] = [];

  // Stream downloader function
  const runStream = async () => {
    let currentChunkSize = 100 * 1024; // Start with 100KB chunk to capture small file stats

    while (performance.now() - startTime < durationMs && !signal.aborted && !isCancelled) {
      const chunkStart = performance.now();
      const requestTimestamp = Date.now();
      
      try {
        activeFetches++;
        const url = region 
          ? `${baseUrl}/download?size=${currentChunkSize}&region=${region}&cb=${Date.now()}-${Math.random()}` 
          : `${baseUrl}/download?size=${currentChunkSize}&cb=${Date.now()}-${Math.random()}`;
        const response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store, no-cache'
          },
          signal
        });

        const headersReceived = performance.now();
        const latency = headersReceived - chunkStart;

        if (!response.body) {
          throw new Error('ReadableStream not supported on download body');
        }

        let bytesReceived = 0;
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bytesReceived += value.length;
            totalBytesDownloaded += value.length;
          }
          // Check for timeout / abort inside reading loop
          if (performance.now() - startTime >= durationMs || signal.aborted) {
            reader.cancel();
            break;
          }
        }

        activeFetches--;
        const chunkEnd = performance.now();
        const chunkDuration = chunkEnd - chunkStart;
        const bps = chunkDuration > 0 ? (bytesReceived * 8) / (chunkDuration / 1000) : 0;

        // Filter loaded pings that occurred during this request
        const requestPings = pingLog
          .filter(p => p.time >= chunkStart && p.time <= chunkEnd)
          .map(p => p.latency);

        downloadRequests.push({
          time: requestTimestamp,
          direction: 'download',
          bytes: currentChunkSize,
          latency,
          bps,
          duration: chunkDuration,
          serverTime: -1,
          responseSize: bytesReceived,
          loadedLatencies: requestPings
        });

        // Determine the target chunk size based on current measured speed in Mbps
        const speedMbps = bps / 1000000;
        if (speedMbps > 80) {
          currentChunkSize = Math.min(25 * 1024 * 1024, currentChunkSize * 4);
        } else if (speedMbps > 30) {
          currentChunkSize = Math.min(10 * 1024 * 1024, currentChunkSize * 2);
        } else if (speedMbps > 8) {
          currentChunkSize = Math.min(5 * 1024 * 1024, currentChunkSize * 2);
        } else if (speedMbps > 2) {
          currentChunkSize = Math.min(1 * 1024 * 1024, currentChunkSize * 2);
        } else {
          currentChunkSize = 100 * 1024;
        }

        // Safety valve: if a single chunk takes too long (> 1800ms), scale down to prevent blocking
        if (chunkDuration > 1800 && currentChunkSize > 100 * 1024) {
          currentChunkSize = Math.max(100 * 1024, Math.floor(currentChunkSize / 2));
        }

      } catch (err) {
        activeFetches--;
        if (signal.aborted) throw err;
        await sleep(200);
      }
    }
  };

  // Launch parallel streams
  const streams = Array.from({ length: parallelStreams }).map(() => runStream());
  await Promise.all(streams);

  clearInterval(progressInterval);
  clearInterval(pingInterval);
  const totalDuration = (performance.now() - startTime) / 1000;
  const finalAvgSpeedBps = totalDuration > 0 ? (totalBytesDownloaded * 8) / totalDuration : 0;

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
 * 3. Upload Test Engine (Concurrent streams uploading random data)
 */
async function runUploadTest(baseUrl: string, region: string | undefined, parallelStreams: number, signal: AbortSignal) {
  const durationMs = 8000; // 8 seconds test window
  const startTime = performance.now();
  let totalBytesUploaded = 0;
  let peakSpeed = 0;
  let activeFetches = 0;

  // Track progress data for reporting
  let lastReportTime = startTime;
  let lastReportBytes = 0;

  // Generate standard 100KB, 1MB, and 10MB non-compressible upload chunks
  const payloadSize100KB = 100 * 1024;
  const payloadSize1MB = 1 * 1024 * 1024;
  const payloadSize10MB = 10 * 1024 * 1024;
  const chunk100KB = new Uint8Array(payloadSize100KB);
  const chunk1MB = new Uint8Array(payloadSize1MB);
  const chunk10MB = new Uint8Array(payloadSize10MB);

  // Track loaded latency pings under upload stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;
  let ulPingSent = 0;
  let ulPingLost = 0;

  // Track loaded latency ping timestamps and values
  const pingLog: { time: number; latency: number }[] = [];

  // Background latency pinger under upload load
  const pingInterval = setInterval(async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) {
      clearInterval(pingInterval);
      return;
    }
    ulPingSent++;
    const pingStart = performance.now();
    try {
      const url = region 
        ? `${baseUrl}/ping?region=${region}&cb=loaded-ul-${Date.now()}` 
        : `${baseUrl}/ping?cb=loaded-ul-${Date.now()}`;
      const res = await fetch(url, { signal, cache: 'no-store' });
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
  }, 800); // Ping every 800ms

  // Helper to safely generate random values within Crypto.getRandomValues 65536 byte limits
  const fillRandomValues = (array: Uint8Array) => {
    const maxQuota = 65536;
    for (let offset = 0; offset < array.length; offset += maxQuota) {
      const subarray = array.subarray(offset, Math.min(offset + maxQuota, array.length));
      self.crypto.getRandomValues(subarray);
    }
  };

  // Fill chunks with random values to make them uncompressible
  if (self.crypto && self.crypto.getRandomValues) {
    fillRandomValues(chunk100KB);
    fillRandomValues(chunk1MB);
    fillRandomValues(chunk10MB);
  } else {
    // Fallback if crypto is unavailable in environment
    for (let i = 0; i < payloadSize100KB; i++) {
      chunk100KB[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < payloadSize1MB; i++) {
      chunk1MB[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < payloadSize10MB; i++) {
      chunk10MB[i] = Math.floor(Math.random() * 256);
    }
  }

  // Monitor progress on timer
  const progressInterval = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;

    if (elapsed >= durationMs / 1000 || signal.aborted) {
      clearInterval(progressInterval);
      clearInterval(pingInterval);
      return;
    }

    const intervalSec = (now - lastReportTime) / 1000;
    const intervalBytes = totalBytesUploaded - lastReportBytes;
    
    // Calculate speeds
    const instSpeedBps = intervalSec > 0 ? (intervalBytes * 8) / intervalSec : 0;
    const avgSpeedBps = elapsed > 0 ? (totalBytesUploaded * 8) / elapsed : 0;
    
    if (instSpeedBps > peakSpeed && elapsed > 0.5) {
      peakSpeed = instSpeedBps; // Capture peak speed (skipping initial transient spike)
    }

    lastReportTime = now;
    lastReportBytes = totalBytesUploaded;

    self.postMessage({
      type: 'UPLOAD_PROGRESS',
      elapsedTime: elapsed,
      totalBytes: totalBytesUploaded,
      instantaneousSpeed: instSpeedBps,
      averageSpeed: avgSpeedBps,
      peakSpeed,
      loadedLatency: loadedAvg,
      loadedJitter: loadedJitter
    });
  }, 100);

  const uploadRequests: any[] = [];

  // Stream uploader function
  const runStream = async () => {
    let currentPayload = chunk100KB; // Start with 100KB payload to collect low-range stats

    while (performance.now() - startTime < durationMs && !signal.aborted && !isCancelled) {
      const chunkStart = performance.now();
      const requestTimestamp = Date.now();
      const payloadSize = currentPayload.length;

      try {
        activeFetches++;
        
        // POST request to `/upload`
        const url = region 
          ? `${baseUrl}/upload?region=${region}&cb=${Date.now()}-${Math.random()}` 
          : `${baseUrl}/upload?cb=${Date.now()}-${Math.random()}`;
        const response = await fetch(url, {
          method: 'POST',
          body: currentPayload,
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store, no-cache',
            'Content-Type': 'application/octet-stream'
          },
          signal
        });

        const headersReceived = performance.now();
        const latency = headersReceived - chunkStart;

        const resData = await response.json(); // Wait for body discard response
        const responseSize = JSON.stringify(resData).length;

        activeFetches--;
        totalBytesUploaded += payloadSize;
        const chunkEnd = performance.now();
        const chunkDuration = chunkEnd - chunkStart;
        const bps = chunkDuration > 0 ? (payloadSize * 8) / (chunkDuration / 1000) : 0;

        // Filter loaded pings that occurred during this request
        const requestPings = pingLog
          .filter(p => p.time >= chunkStart && p.time <= chunkEnd)
          .map(p => p.latency);

        uploadRequests.push({
          time: requestTimestamp,
          direction: 'upload',
          bytes: payloadSize,
          latency,
          bps,
          duration: chunkDuration,
          serverTime: -1,
          responseSize,
          loadedLatencies: requestPings
        });

        // Progressive size: Adjust block sizing depending on upload speed in Mbps
        const speedMbps = bps / 1000000;
        if (speedMbps > 40) {
          currentPayload = chunk10MB;
        } else if (speedMbps > 8) {
          currentPayload = chunk1MB;
        } else {
          currentPayload = chunk100KB;
        }

        // Safety valve: if upload chunk takes too long (> 2000ms), scale down
        if (chunkDuration > 2000) {
          if (currentPayload === chunk10MB) {
            currentPayload = chunk1MB;
          } else if (currentPayload === chunk1MB) {
            currentPayload = chunk100KB;
          }
        }

      } catch (err) {
        activeFetches--;
        if (signal.aborted) throw err;
        await sleep(200); // Backoff before retry
      }
    }
  };

  // Launch parallel streams
  const streams = Array.from({ length: parallelStreams }).map(() => runStream());
  await Promise.all(streams);

  clearInterval(progressInterval);
  clearInterval(pingInterval);
  const totalDuration = (performance.now() - startTime) / 1000;
  const finalAvgSpeedBps = totalDuration > 0 ? (totalBytesUploaded * 8) / totalDuration : 0;

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
