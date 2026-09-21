import type { APIRoute } from "astro";
import { isLocalHost } from "../../speed-test/utils/speedTestUtils";
import { CONFIG } from "../../speed-test/utils/speedTestConfig";
import { getClientIP } from "./rateLimiter";

// Response headers that prevent ALL caching layers from storing the result.
const NO_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...NO_CACHE_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
};

// Server-side IP detection with multi-service fallback chain.
// Used when the server can't determine the real client IP from request headers
// (e.g., localhost dev server where all requests come from 127.0.0.1).
async function fetchRealPublicIp(): Promise<string | null> {
  const timeoutMs = CONFIG.GEO_SERVICE_TIMEOUT_MS;

  // 1. api.ipify.org — lightweight JSON endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip && typeof data.ip === "string") return data.ip.trim();
    }
  } catch (_) { }

  // 2. api.bigdatacloud.net — fallback
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://api.bigdatacloud.net/client/ip", {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip && typeof data.ip === "string") return data.ip.trim();
    }
  } catch (_) { }

  // 3. ifconfig.me — plain text IP
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://ifconfig.me/ip", {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text;
    }
  } catch (_) { }

  // 4. icanhazip.com — plain text IP
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://icanhazip.com", {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text;
    }
  } catch (_) { }

  return null;
}

// Server-side fallback geolocation with multi-service chain and timeouts.
async function fetchServerGeo(ip: string) {
  const timeoutMs = CONFIG.GEO_SERVICE_TIMEOUT_MS;
  let bestOrg = "";
  let bestCity = "";
  let bestRegion = "";
  let bestCountryCode = "";
  let bestLat: number | null = null;
  let bestLon: number | null = null;

  const merge = (org: string, city: string, region: string, countryCode: string, lat: number | null, lon: number | null) => {
    if (org) bestOrg = org;
    if (city) bestCity = city;
    if (region) bestRegion = region;
    if (countryCode) bestCountryCode = countryCode;
    if (lat !== null && Number.isFinite(lat)) bestLat = lat;
    if (lon !== null && Number.isFinite(lon)) bestLon = lon;
  };

  // 1. Try freeipapi.com
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        const org = data.orgName || data.isp || "";
        const lat = typeof data.latitude === "number" ? data.latitude : null;
        const lon = typeof data.longitude === "number" ? data.longitude : null;
        merge(org, data.cityName || "", data.regionName || "", data.countryCode || "", lat, lon);
      }
    }
  } catch (_) { }

  // 2. Try ipapi.co
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        const org = data.org || "";
        const lat = typeof data.latitude === "number" ? data.latitude : null;
        const lon = typeof data.longitude === "number" ? data.longitude : null;
        merge(org, data.city || "", data.region || "", data.country || "", lat, lon);
      }
    }
  } catch (_) { }

  // 3. Try ipinfo.io
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        let lat: number | null = null;
        let lon: number | null = null;
        if (typeof data.loc === "string") {
          const [parsedLat, parsedLon] = data.loc.split(",").map(Number);
          if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
            lat = parsedLat;
            lon = parsedLon;
          }
        }
        merge(data.org || "", data.city || "", data.region || "", data.country || "", lat, lon);
      }
    }
  } catch (_) { }

  // 4. Try ip-api.com
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,isp,org,city,regionName,countryCode,lat,lon`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success") {
        const org = data.org || data.isp || "";
        const lat = typeof data.lat === "number" ? data.lat : null;
        const lon = typeof data.lon === "number" ? data.lon : null;
        merge(org, data.city || "", data.regionName || "", data.countryCode || "", lat, lon);
      }
    }
  } catch (_) { }

  if (!bestOrg && bestLat === null) return null;
  return {
    city: bestCity || "Unknown City",
    region: bestRegion || "Unknown Region",
    countryCode: bestCountryCode || "",
    latitude: bestLat ?? 0,
    longitude: bestLon ?? 0,
    org: bestOrg || "Edge Network Provider",
  };
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  try {
    const headers = request?.headers || new Headers();
    const searchParams = url?.searchParams || new URLSearchParams();

    const paramIp = searchParams.get("ip");
    const clientLatParam = searchParams.get("clientLat") || searchParams.get("lat");
    const clientLonParam = searchParams.get("clientLon") || searchParams.get("lon");
    const clientCityParam = searchParams.get("city");
    const clientRegionParam = searchParams.get("region");
    const clientCountryCodeParam = searchParams.get("countryCode") || searchParams.get("country");

    // 1. IP Detection with safe fallback
    let clientIp = paramIp?.trim() || getClientIP(headers) || "127.0.0.1";

    const isLocal = isLocalHost(clientIp);

    // On localhost, fetch the real public IP server-side so local dev displays accurate ISP/geo
    if (isLocal && !paramIp) {
      try {
        const realIp = await fetchRealPublicIp();
        if (realIp) clientIp = realIp;
      } catch {
        // Fallback silently if public IP fetch fails
      }
    }

    // Parse coordinates if provided by client
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (clientLatParam) {
      const pLat = parseFloat(clientLatParam);
      if (Number.isFinite(pLat) && pLat >= -90 && pLat <= 90) latitude = pLat;
    }
    if (clientLonParam) {
      const pLon = parseFloat(clientLonParam);
      if (Number.isFinite(pLon) && pLon >= -180 && pLon <= 180) longitude = pLon;
    }

    let city = clientCityParam?.trim() || "";
    let region = clientRegionParam?.trim() || "";
    let countryCode = clientCountryCodeParam?.trim() || "";

    // Reverse geocode precise client coordinates if available
    if ((!city || !region || !countryCode) && latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0)) {
      try {
        const geoRes = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          city = geoData.city || geoData.locality || city;
          region = geoData.principalSubdivision || region;
          countryCode = geoData.countryCode || countryCode;
        }
      } catch {
        // Silently skip reverse geocode failure
      }
    }

    // 2. Geolocation parsing from Edge headers (Vercel / Cloudflare) or request.cf / locals
    const cf = (request as any)?.cf || (locals as any)?.runtime?.cf;
    const asn = headers.get("cf-asn") || (cf?.asn ? String(cf.asn) : "");
    let org =
      headers.get("cf-as-organization") ||
      cf?.asOrganization ||
      "Edge Network Provider";

    if (latitude === null || longitude === null) {
      const headerLat = headers.get("x-vercel-ip-latitude") || headers.get("cf-latitude") || (cf?.latitude ? String(cf.latitude) : null);
      const headerLon = headers.get("x-vercel-ip-longitude") || headers.get("cf-longitude") || (cf?.longitude ? String(cf.longitude) : null);
      if (headerLat) {
        const pLat = parseFloat(headerLat);
        if (Number.isFinite(pLat)) latitude = pLat;
      }
      if (headerLon) {
        const pLon = parseFloat(headerLon);
        if (Number.isFinite(pLon)) longitude = pLon;
      }
    }

    if (!city) {
      city = headers.get("x-vercel-ip-city") || headers.get("cf-ipcity") || cf?.city || "";
    }
    if (!region) {
      region = headers.get("x-vercel-ip-country-region") || headers.get("cf-region") || cf?.region || "";
    }
    if (!countryCode) {
      countryCode = headers.get("x-vercel-ip-country") || headers.get("cf-ipcountry") || cf?.country || "";
    }

    // 3. Fallback to server-to-server lookup if coordinates or metadata are missing
    let geoFallback = null as Awaited<ReturnType<typeof fetchServerGeo>> | null;
    if (latitude === null || longitude === null || !org || org === "Edge Network Provider") {
      try {
        geoFallback = await fetchServerGeo(clientIp);
        if (geoFallback) {
          if (latitude === null) latitude = geoFallback.latitude;
          if (longitude === null) longitude = geoFallback.longitude;
          if (!city) city = geoFallback.city;
          if (!region) region = geoFallback.region;
          if (!countryCode) countryCode = geoFallback.countryCode;
          if (!org || org === "Edge Network Provider") org = geoFallback.org;
        }
      } catch {
        // Fallback safely
      }
    }

    // Translate 2-letter country code into full English country name
    let countryName = "Unknown Country";
    if (countryCode) {
      const code = countryCode.toString().toUpperCase().trim();
      if (code.length === 2) {
        try {
          const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
          countryName = regionNames.of(code) || code;
        } catch {
          countryName = code;
        }
      } else {
        countryName = countryCode.toString();
      }
    }

    return new Response(
      JSON.stringify({
        isLocal: isLocal,
        ip: clientIp,
        city: city || "Unknown City",
        region: region || "Unknown Region",
        country: countryName,
        countryCode: countryCode || "Unknown",
        org: asn ? `AS${asn} ${org}` : org,
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        isApproximate: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...NO_CACHE_HEADERS,
        },
      },
    );
  } catch (err: any) {
    // Top-level error boundary: Always return a safe, graceful 200 response to keep UI responsive
    console.error("[ip-geo API Error]", err?.message || err);
    return new Response(
      JSON.stringify({
        isLocal: true,
        ip: "127.0.0.1",
        city: "Unknown City",
        region: "Unknown Region",
        country: "Unknown Country",
        countryCode: "Unknown",
        org: "Edge Network Provider",
        latitude: 0,
        longitude: 0,
        isApproximate: true,
        fallback: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...NO_CACHE_HEADERS,
        },
      },
    );
  }
};
