import type { APIRoute } from 'astro';
import { SERVER_LIST } from '../../utils/serverListUtils';
import { haversineDistance } from '../../utils/speedTestUtils';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

export const POST: APIRoute = async ({ request, url }) => {
  const region = url.searchParams.get('region');
  const serverId = url.searchParams.get('serverId');
  const clientLatParam = url.searchParams.get('clientLat');
  const clientLonParam = url.searchParams.get('clientLon');
  const basePingParam = url.searchParams.get('basePing');

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
    const clientLat = clientLatParam ? parseFloat(clientLatParam) : parseFloat(headers.get('x-vercel-ip-latitude') || headers.get('cf-latitude') || '0');
    const clientLon = clientLonParam ? parseFloat(clientLonParam) : parseFloat(headers.get('x-vercel-ip-longitude') || headers.get('cf-longitude') || '0');
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

  let uploadBody = request.body;
  if (uploadBody && shouldThrottle) {
    uploadBody = createThrottledStream(uploadBody as any, maxThroughputBps) as any;
  }

  // In local development, always proxy the upload body to Cloudflare to measure actual upload speed
  if (isLocal && region !== 'local-edge' && uploadBody) {
    try {
      const cfResponse = await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        body: uploadBody,
        headers: {
          'Cache-Control': 'no-store, no-cache',
          'Content-Type': 'application/octet-stream',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (cfResponse.ok) {
        // Read response body fully to ensure completion
        await cfResponse.text();

        return new Response(JSON.stringify({
          success: true,
          bytesReceived: parseInt(request.headers.get('content-length') || '0', 10)
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, no-transform, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Encoding': 'identity',
            'Access-Control-Allow-Origin': '*',
            'Timing-Allow-Origin': '*'
          }
        });
      }
    } catch (err) {
      console.error('Failed to proxy remote upload:', err);
    }
  }

  // Stream-read upload body to completion
  let totalBytesUploaded = 0;
  if (uploadBody) {
    const reader = uploadBody.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytesUploaded += value.length;
        }
      }
    } catch (err) {
      console.error('Upload read error:', err);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    bytesReceived: totalBytesUploaded
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, no-transform, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity',
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*'
    }
  });
};

export const GET: APIRoute = async () => {
  return new Response('Use POST to test upload speeds', { status: 405 });
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
      'Access-Control-Max-Age': '86400'
    }
  });
};
