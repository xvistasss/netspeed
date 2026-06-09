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

  for (let i = 0; i < iterations; i++) {
    if (isCancelled || signal.aborted) break;

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
        latencies: [...latencies]
      });

      // Brief sleep between pings to prevent queueing overhead
      await sleep(60);
    } catch (err) {
      if (signal.aborted) throw err;
      self.postMessage({
        type: 'PING_FAILED_ITERATION',
        iteration: i + 1,
      });
    }
  }

  self.postMessage({ type: 'PING_COMPLETE', latencies, jitter });
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

  // Background latency pinger under download load
  const pingInterval = setInterval(async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) {
      clearInterval(pingInterval);
      return;
    }
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
        
        loadedAvg = loadedLatencies.reduce((a, b) => a + b, 0) / loadedLatencies.length;
        if (loadedLatencies.length > 1) {
          let sumDiffs = 0;
          for (let j = 1; j < loadedLatencies.length; j++) {
            sumDiffs += Math.abs(loadedLatencies[j] - loadedLatencies[j - 1]);
          }
          loadedJitter = sumDiffs / (loadedLatencies.length - 1);
        }
      }
    } catch (_) {}
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

  // Stream downloader function
  const runStream = async () => {
    let currentChunkSize = 1 * 1024 * 1024; // Start with 1MB chunk

    while (performance.now() - startTime < durationMs && !signal.aborted && !isCancelled) {
      const chunkStart = performance.now();
      
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

        if (!response.body) {
          throw new Error('ReadableStream not supported on download body');
        }

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytesDownloaded += value.length;
          }
          // Check for timeout / abort inside reading loop
          if (performance.now() - startTime >= durationMs || signal.aborted) {
            reader.cancel();
            break;
          }
        }

        activeFetches--;
        const chunkDuration = performance.now() - chunkStart;

        if (chunkDuration < 300 && currentChunkSize < 25 * 1024 * 1024) {
          currentChunkSize = Math.min(25 * 1024 * 1024, currentChunkSize * 2);
        } else if (chunkDuration > 1500 && currentChunkSize > 1 * 1024 * 1024) {
          currentChunkSize = Math.max(1 * 1024 * 1024, currentChunkSize / 2);
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
    loadedJitter: loadedJitter
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

  // Generate standard 1MB and 2MB non-compressible upload chunks
  const payloadSize1MB = 1 * 1024 * 1024;
  const payloadSize2MB = 2 * 1024 * 1024;
  const chunk1MB = new Uint8Array(payloadSize1MB);
  const chunk2MB = new Uint8Array(payloadSize2MB);

  // Track loaded latency pings under upload stress
  const loadedLatencies: number[] = [];
  let loadedJitter = 0;
  let loadedAvg = 0;

  // Background latency pinger under upload load
  const pingInterval = setInterval(async () => {
    if (signal.aborted || performance.now() - startTime >= durationMs) {
      clearInterval(pingInterval);
      return;
    }
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
        
        loadedAvg = loadedLatencies.reduce((a, b) => a + b, 0) / loadedLatencies.length;
        if (loadedLatencies.length > 1) {
          let sumDiffs = 0;
          for (let j = 1; j < loadedLatencies.length; j++) {
            sumDiffs += Math.abs(loadedLatencies[j] - loadedLatencies[j - 1]);
          }
          loadedJitter = sumDiffs / (loadedLatencies.length - 1);
        }
      }
    } catch (_) {}
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
    fillRandomValues(chunk1MB);
    fillRandomValues(chunk2MB);
  } else {
    // Fallback if crypto is unavailable in environment
    for (let i = 0; i < payloadSize1MB; i++) {
      chunk1MB[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < payloadSize2MB; i++) {
      chunk2MB[i] = Math.floor(Math.random() * 256);
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

  // Stream uploader function
  const runStream = async () => {
    let currentPayload = chunk1MB; // Start with 1MB payload

    while (performance.now() - startTime < durationMs && !signal.aborted && !isCancelled) {
      const chunkStart = performance.now();
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

        await response.json(); // Wait for body discard response

        activeFetches--;
        totalBytesUploaded += payloadSize;
        const chunkDuration = performance.now() - chunkStart;

        // Progressive size: Adjust block sizing depending on speed
        if (chunkDuration < 250 && currentPayload === chunk1MB) {
          currentPayload = chunk2MB; // Scale to 2MB chunk
        } else if (chunkDuration > 1500 && currentPayload === chunk2MB) {
          currentPayload = chunk1MB; // Downscale to 1MB chunk
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
    loadedJitter: loadedJitter
  });
}
