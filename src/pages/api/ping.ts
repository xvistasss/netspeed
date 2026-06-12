import type { APIRoute } from 'astro';
import { SERVER_LIST } from '../../utils/serverListUtils';
import { haversineDistance } from '../../utils/speedTestUtils';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const GET: APIRoute = async ({ request, url }) => {
  const region = url.searchParams.get('region');
  const serverId = url.searchParams.get('serverId');
  const clientLatParam = url.searchParams.get('clientLat');
  const clientLonParam = url.searchParams.get('clientLon');
  const isWarmup = url.searchParams.get('warmup') === 'true';
  const hostLatencyParam = url.searchParams.get('hostLatency');
  const hostLatency = hostLatencyParam ? parseFloat(hostLatencyParam) : 0;

  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0].toLowerCase();
  const isLocal = 
    hostname === 'localhost' || 
    hostname === '127.0.0.1' || 
    hostname === '::1' || 
    hostname.startsWith('192.168.') || 
    hostname.startsWith('10.') || 
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

  // Parse client location from params or fallback to headers
  const headers = request.headers;
  const clientLat = clientLatParam ? parseFloat(clientLatParam) : parseFloat(headers.get('x-vercel-ip-latitude') || headers.get('cf-latitude') || '0');
  const clientLon = clientLonParam ? parseFloat(clientLonParam) : parseFloat(headers.get('x-vercel-ip-longitude') || headers.get('cf-longitude') || '0');

  // Find target server coordinates
  let serverLat = 0;
  let serverLon = 0;
  let hasServerCoords = false;

  if (serverId || region) {
    const server = serverId 
      ? SERVER_LIST.find(s => s.id === serverId) 
      : (region ? SERVER_LIST.find(s => s.region === region) : undefined);
    if (server) {
      serverLat = server.lat;
      serverLon = server.lon;
      hasServerCoords = true;
    }
  }

  // Calculate simulated target latency
  let targetLatency = 0;
  if (region === 'local-edge') {
    targetLatency = isLocal ? 15 : hostLatency;
  } else if (hasServerCoords && clientLat !== 0 && clientLon !== 0) {
    const distance = haversineDistance(clientLat, clientLon, serverLat, serverLon);
    targetLatency = (distance / 100) * 1.5 + 5; // 1.5ms per 100km, plus 5ms base last-mile RTT
  } else if (region) {
    const defaultDelays: Record<string, number> = {
      'us-east': 80, 'us-central': 100, 'us-west': 120,
      'ca-central': 90, 'eu-central': 110, 'eu-west': 95,
      'ap-southeast': 150, 'ap-northeast': 130, 'ap-south': 15,
      'sa-east': 220, 'af-south': 200
    };
    targetLatency = defaultDelays[region] || 20;
  }

  // Measure base latency in local development (avoid external fetches to prevent rate limiting & latency distortion)
  let proxyPingDuration = 0;

  // Calculate final sleep delay.
  let additionalDelay = 0;
  if (!isWarmup) {
    if (isLocal) {
      additionalDelay = Math.max(0, targetLatency - proxyPingDuration);
    } else {
      additionalDelay = Math.max(0, targetLatency - hostLatency);
    }
  }

  if (additionalDelay > 0) {
    await delay(additionalDelay);
  }

  // Return tiny payload with cache-control and content-encoding overrides
  return new Response('pong', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store, no-cache, no-transform, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Encoding': 'identity', // Turn off server-side Gzip / Brotli
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*'
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

