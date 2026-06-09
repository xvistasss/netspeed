import type { APIRoute } from 'astro';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const POST: APIRoute = async ({ request, url }) => {
  const region = url.searchParams.get('region');
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
  // proxy the upload body to Cloudflare to measure actual upload speed.
  if (isLocal && !region && request.body) {
    try {
      const cfResponse = await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        body: request.body,
        duplex: 'half',
        headers: {
          'Cache-Control': 'no-store, no-cache',
          'Content-Type': 'application/octet-stream'
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
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Encoding': 'identity',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (err) {
      console.error('Failed to proxy remote upload:', err);
    }
  }

  // Speed throttle limits in bits per second (bps) for uploads
  let throttleSpeedBps = 0;
  if (region) {
    if (region === 'us-east') {
      throttleSpeedBps = 30 * 1024 * 1024; // 30 Mbps upload
    } else if (region === 'eu-central') {
      throttleSpeedBps = 15 * 1024 * 1024; // 15 Mbps upload
    } else if (region === 'ap-southeast') {
      throttleSpeedBps = 5 * 1024 * 1024; // 5 Mbps upload
    }
  }

  let totalBytesUploaded = 0;
  const reader = request.body?.getReader();

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const chunkSize = value.length;
          totalBytesUploaded += chunkSize;

          // Introduce delay between chunk reads to backpressure client upload stream
          if (throttleSpeedBps > 0) {
            const chunkBits = chunkSize * 8;
            const delayMs = (chunkBits / throttleSpeedBps) * 1000;
            await delay(delayMs);
          } else {
            await delay(0); // Let event loop breathe
          }
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
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity',
      'Access-Control-Allow-Origin': '*'
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
