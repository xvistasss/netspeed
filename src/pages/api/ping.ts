import type { APIRoute } from 'astro';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const GET: APIRoute = async ({ request, url }) => {
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
  // fetch from Cloudflare to measure actual internet latency.
  if (isLocal && !region) {
    try {
      const response = await fetch('https://speed.cloudflare.com/__ping', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store, no-cache'
        }
      });
      await response.text();
    } catch (err) {
      console.error('Failed to proxy remote ping:', err);
    }
  }

  // Introduce artificial delay for simulated remote servers
  if (region) {
    if (region === 'us-east') {
      await delay(120); // Simulate North America latency
    } else if (region === 'eu-central') {
      await delay(190); // Simulate Europe latency
    } else if (region === 'ap-southeast') {
      await delay(260); // Simulate Asia Pacific latency
    }
  }

  // Return tiny payload with cache-control and content-encoding overrides
  return new Response('pong', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity', // Turn off server-side Gzip / Brotli
      'Access-Control-Allow-Origin': '*'
    }
  });
};

export const POST: APIRoute = GET; // Accept POST as well
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
      'Access-Control-Max-Age': '86400'
    }
  });
};
