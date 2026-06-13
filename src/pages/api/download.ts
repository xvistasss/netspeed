import type { APIRoute } from 'astro';
import { SERVER_LIST } from '../../utils/serverListUtils';
import { haversineDistance } from '../../utils/speedTestUtils';

// Pre-generate a 4MB non-compressible pseudo-random byte buffer on module load
const bufferSize = 4 * 1024 * 1024; // 4MB
const preGeneratedBuffer = new Uint8Array(bufferSize);
for (let i = 0; i < bufferSize; i++) {
  preGeneratedBuffer[i] = Math.floor(Math.random() * 256);
}


// Throttled stream helper using Token Bucket pacing
function createThrottledStream(sourceStream: ReadableStream<Uint8Array>, maxBps: number): ReadableStream<Uint8Array> {
  const reader = sourceStream.getReader();
  
  // Token Bucket Pacing: allow bursts up to 200ms of data, minimum 1MB capacity
  const capacity = Math.max(maxBps * 0.2, 1024 * 1024);
  let tokens = capacity;
  let lastRefillTime = performance.now();

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        if (value) {
          const chunkSize = value.length;
          const now = performance.now();
          const elapsed = now - lastRefillTime;
          lastRefillTime = now;

          // Refill tokens based on elapsed time (seconds)
          tokens = Math.min(capacity, tokens + (elapsed / 1000) * maxBps);

          if (tokens < chunkSize) {
            // Calculate necessary wait time to acquire sufficient tokens
            const neededTokens = chunkSize - tokens;
            const waitTimeMs = (neededTokens / maxBps) * 1000;

            await new Promise(resolve => setTimeout(resolve, waitTimeMs));

            // Refill tokens again after sleeping
            const postSleepNow = performance.now();
            const postSleepElapsed = postSleepNow - lastRefillTime;
            lastRefillTime = postSleepNow;
            tokens = Math.min(capacity, tokens + (postSleepElapsed / 1000) * maxBps);
          }

          // Deduct tokens and send the chunk
          tokens = Math.max(0, tokens - chunkSize);
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    }
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const sizeParam = url.searchParams.get('size');
  const region = url.searchParams.get('region');
  const serverId = url.searchParams.get('serverId');
  const clientLatParam = url.searchParams.get('clientLat');
  const clientLonParam = url.searchParams.get('clientLon');
  const basePingParam = url.searchParams.get('basePing');

  // Default to 10MB if no size is specified
  const size = sizeParam ? parseInt(sizeParam, 10) : 10 * 1024 * 1024;

  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0].toLowerCase();
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

  // Compute dynamic speed limit based on BDP: Throughput = Window_Size (1.5MB) / RTT
  let maxThroughputBps = Infinity;
  let shouldThrottle = false;

  if (region && region !== 'local-edge') {
    const headers = request.headers;
    const cf = (request as any).cf;
    const clientLat = clientLatParam 
      ? parseFloat(clientLatParam) 
      : parseFloat(headers.get('x-vercel-ip-latitude') || headers.get('cf-latitude') || cf?.latitude || '0');
    const clientLon = clientLonParam 
      ? parseFloat(clientLonParam) 
      : parseFloat(headers.get('x-vercel-ip-longitude') || headers.get('cf-longitude') || cf?.longitude || '0');
    const basePing = basePingParam ? parseFloat(basePingParam) : 0;

    let serverLat = 0;
    let serverLon = 0;
    let hasServerCoords = false;

    const server = serverId 
      ? SERVER_LIST.find(s => s.id === serverId) 
      : (region ? SERVER_LIST.find(s => s.region === region) : undefined);
    if (server) {
      serverLat = server.lat;
      serverLon = server.lon;
      hasServerCoords = true;
    }

    let estimatedRtt = 20;
    if (basePing > 0) {
      estimatedRtt = basePing;
    } else if (hasServerCoords && clientLat !== 0 && clientLon !== 0) {
      const distance = haversineDistance(clientLat, clientLon, serverLat, serverLon);
      estimatedRtt = (distance / 100) * 1.5 + 5;
    } else {
      const defaultDelays: Record<string, number> = {
        'us-east': 80, 'us-central': 100, 'us-west': 120,
        'ca-central': 90, 'eu-central': 110, 'eu-west': 95,
        'ap-southeast': 150, 'ap-northeast': 130, 'ap-south': 15,
        'sa-east': 220, 'af-south': 200
      };
      estimatedRtt = defaultDelays[region] || 100;
    }

    // Max TCP throughput = 10MB scaled window / RTT (modern TCP Window representation)
    maxThroughputBps = (10 * 1024 * 1024) / (estimatedRtt / 1000);
    shouldThrottle = maxThroughputBps < 125 * 1024 * 1024; // Only throttle if limit is under 1 Gbps (125 MB/s)
  }

  let sourceStream: ReadableStream<Uint8Array>;

  // In local development, always proxy to Cloudflare to measure actual internet speed
  if (isLocal && region !== 'local-edge') {
    try {
      const cfResponse = await fetch(`https://speed.cloudflare.com/__down?bytes=${size}`, {
        headers: {
          'Cache-Control': 'no-store, no-cache',
          'Pragma': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (cfResponse.ok && cfResponse.body) {
        sourceStream = cfResponse.body as ReadableStream<Uint8Array>;
      } else {
        console.warn(`Cloudflare download fetch failed with status: ${cfResponse.status} ${cfResponse.statusText}`);
        console.warn('Headers:', Object.fromEntries(cfResponse.headers.entries()));
        throw new Error(`Cloudflare fetch not ok: status ${cfResponse.status}`);
      }
    } catch (err: any) {
      console.error('Failed to proxy remote download, falling back to local generator:', err.message || err);
      // Fallback generator
      sourceStream = createLocalGeneratorStream(size);
    }
  } else {
    sourceStream = createLocalGeneratorStream(size);
  }

  const finalStream = shouldThrottle
    ? createThrottledStream(sourceStream, maxThroughputBps)
    : sourceStream;

  return new Response(finalStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size.toString(),
      'Cache-Control': 'no-store, no-cache, no-transform, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity', // Zero compression (crucial for random data speeds)
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*'
    }
  });
};

function createLocalGeneratorStream(size: number): ReadableStream<Uint8Array> {
  const chunkSize = 256 * 1024; // 256KB chunks
  let bytesSent = 0;

  return new ReadableStream({
    pull(controller) {
      if (bytesSent >= size) {
        controller.close();
        return;
      }
      const remaining = size - bytesSent;
      const currentChunkSize = Math.min(chunkSize, remaining);

      // Enqueue unique slice of pre-generated buffer using random offset
      const maxOffset = bufferSize - currentChunkSize;
      const randomOffset = Math.floor(Math.random() * maxOffset);
      controller.enqueue(preGeneratedBuffer.slice(randomOffset, randomOffset + currentChunkSize));
      bytesSent += currentChunkSize;
    }
  });
}


export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
      'Access-Control-Max-Age': '86400'
    }
  });
};
