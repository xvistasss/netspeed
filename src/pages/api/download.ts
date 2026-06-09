import type { APIRoute } from 'astro';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Pre-generate a 1MB non-compressible pseudo-random byte buffer on module load
const bufferSize = 1024 * 1024; // 1MB
const preGeneratedBuffer = new Uint8Array(bufferSize);
for (let i = 0; i < bufferSize; i++) {
  // Use a simple pseudo-random byte generator
  preGeneratedBuffer[i] = Math.floor(Math.random() * 256);
}

export const GET: APIRoute = async ({ request, url }) => {
  const sizeParam = url.searchParams.get('size');
  const region = url.searchParams.get('region');
  
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

  // If local development environment and not simulating a remote region,
  // fetch from Cloudflare to measure actual internet download speed.
  if (isLocal && !region) {
    try {
      const cfResponse = await fetch(`https://speed.cloudflare.com/__down?bytes=${size}`, {
        headers: {
          'Cache-Control': 'no-store, no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (cfResponse.ok && cfResponse.body) {
        return new Response(cfResponse.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': size.toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Encoding': 'identity', // Zero compression
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (err) {
      console.error('Failed to proxy remote download:', err);
    }
  }

  // Bandwidth throttle limits in bits per second (bps) for simulated servers
  let throttleSpeedBps = 0;
  if (region) {
    if (region === 'us-east') {
      throttleSpeedBps = 80 * 1024 * 1024; // 80 Mbps
    } else if (region === 'eu-central') {
      throttleSpeedBps = 40 * 1024 * 1024; // 40 Mbps
    } else if (region === 'ap-southeast') {
      throttleSpeedBps = 15 * 1024 * 1024; // 15 Mbps
    }
  }

  // Create stream chunk-by-chunk to allow progressive measuring
  const chunkSize = 256 * 1024; // 256KB chunks
  let bytesSent = 0;

  const stream = new ReadableStream({
    async start(controller) {
      while (bytesSent < size) {
        const remaining = size - bytesSent;
        const currentChunkSize = Math.min(chunkSize, remaining);
        
        // Enqueue slice of pre-generated buffer
        controller.enqueue(preGeneratedBuffer.slice(0, currentChunkSize));
        bytesSent += currentChunkSize;

        // Introduce delay to throttle bandwidth if region specified
        if (throttleSpeedBps > 0) {
          const chunkBits = currentChunkSize * 8;
          const delayMs = (chunkBits / throttleSpeedBps) * 1000;
          await delay(delayMs);
        } else {
          // Micro delay to yield control and let the JS event loop breathe
          await delay(0);
        }
      }
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity', // Zero compression (crucial for random data speeds)
      'Access-Control-Allow-Origin': '*'
    }
  });
};

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
