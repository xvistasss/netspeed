import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const headers = request.headers;
  
  // 1. IP Detection
  const clientIp = 
    headers.get('cf-connecting-ip') || 
    headers.get('x-real-ip') || 
    headers.get('x-vercel-forwarded-for') || 
    headers.get('x-forwarded-for')?.split(',')[0].trim() || 
    '127.0.0.1';

  // Check if loopback/local IP to trigger client-side fallback
  const isLocal = 
    clientIp === '127.0.0.1' || 
    clientIp === '::1' || 
    clientIp.startsWith('10.') || 
    clientIp.startsWith('192.168.') || 
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clientIp);

  if (isLocal) {
    return new Response(JSON.stringify({
      isLocal: true,
      ip: clientIp,
      city: 'Local Host',
      region: 'Intranet',
      country: 'Local',
      countryCode: 'LO',
      loc: '0,0',
      org: 'Local Network',
      latitude: 0,
      longitude: 0
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  }

  // 2. Geolocation parsing from Edge headers (Vercel / Cloudflare)
  const latitude = headers.get('x-vercel-ip-latitude') || headers.get('cf-latitude');
  const longitude = headers.get('x-vercel-ip-longitude') || headers.get('cf-longitude');
  const city = headers.get('x-vercel-ip-city') || headers.get('cf-ipcity') || 'Unknown City';
  const country = headers.get('x-vercel-ip-country') || headers.get('cf-ipcountry') || 'Unknown Country';
  const region = headers.get('x-vercel-ip-country-region') || headers.get('cf-region') || 'Unknown Region';
  const asn = headers.get('cf-asn') || '';
  const org = headers.get('cf-as-organization') || 'Edge Network Provider';

  return new Response(JSON.stringify({
    isLocal: false,
    ip: clientIp,
    city,
    region,
    country,
    countryCode: country,
    loc: latitude && longitude ? `${latitude},${longitude}` : undefined,
    org: asn ? `AS${asn} ${org}` : org,
    latitude: latitude ? parseFloat(latitude) : undefined,
    longitude: longitude ? parseFloat(longitude) : undefined
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
};
