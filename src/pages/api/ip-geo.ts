import type { APIRoute } from "astro";
import { isLocalHost } from "../../speed-test/utils/speedTestUtils";
import { CONFIG } from "../../speed-test/utils/speedTestConfig";

// Response headers that prevent ALL caching layers from storing the result.
const NO_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

// Server-side IP detection with multi-service fallback chain.
// Used when the server can't determine the real client IP from request headers
// (e.g., localhost dev server where all requests come from 127.0.0.1).
async function fetchRealPublicIp(): Promise<string | null> {
  const timeoutMs = CONFIG.GEO_SERVICE_TIMEOUT_MS;

  // 1. api.ipify.org — most common, lightweight JSON endpoint
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
      if (data?.ip) return data.ip;
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
      if (data?.ip) return data.ip;
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

// Server-side fallback geolocation with 4-service chain and timeouts.
// Extracts org (ISP) independently of coordinates — if a service returns valid
// ISP data but invalid coordinates, we still use the ISP. This prevents
// discarding useful ISP info when coordinate parsing fails.
//
// Service ordering matters: services are called sequentially and later results
// overwrite earlier ones for each field. More accurate services for Indian IPs
// (ipinfo.io, ip-api.com) are placed last so their data takes precedence.
async function fetchServerGeo(ip: string) {
  const timeoutMs = CONFIG.GEO_SERVICE_TIMEOUT_MS;
  let bestOrg = "";
  let bestCity = "";
  let bestRegion = "";
  let bestCountryCode = "";
  let bestLat: number | null = null;
  let bestLon: number | null = null;

  // Helper: merge a service's result into best*, overwriting with each later
  // service so that the most accurate provider (last in chain) wins.
  const merge = (org: string, city: string, region: string, countryCode: string, lat: number | null, lon: number | null) => {
    if (org) bestOrg = org;
    if (city) bestCity = city;
    if (region) bestRegion = region;
    if (countryCode) bestCountryCode = countryCode;
    if (lat !== null) bestLat = lat;
    if (lon !== null) bestLon = lon;
  };

  // 1. Try freeipapi.com
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`, {
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
  } catch (err) {
    console.error("Server-side freeipapi lookup failed:", err);
  }

  // 2. Try ipapi.co
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
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
  } catch (err) {
    console.error("Server-side ipapi lookup failed:", err);
  }

  // 3. Try ipinfo.io
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        let lat: number | null = null;
        let lon: number | null = null;
        if (data.loc) {
          const [parsedLat, parsedLon] = data.loc.split(",").map(Number);
          if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
            lat = parsedLat;
            lon = parsedLon;
          }
        }
        merge(data.org || "", data.city || "", data.region || "", data.country || "", lat, lon);
      }
    }
  } catch (err) {
    console.error("Server-side ipinfo lookup failed:", err);
  }

  // 4. Try ip-api.com — free, no API key, often better ISP data for Indian IPs
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,isp,org,city,regionName,countryCode,lat,lon`, {
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
  } catch (err) {
    console.error("Server-side ip-api lookup failed:", err);
  }

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

export const GET: APIRoute = async ({ request, url }) => {
  const headers = request.headers;
  const paramIp = url.searchParams.get("ip");
  const clientLatParam = url.searchParams.get("clientLat") || url.searchParams.get("lat");
  const clientLonParam = url.searchParams.get("clientLon") || url.searchParams.get("lon");
  const clientCityParam = url.searchParams.get("city");
  const clientRegionParam = url.searchParams.get("region");
  const clientCountryCodeParam = url.searchParams.get("countryCode") || url.searchParams.get("country");

  // 1. IP Detection
  let clientIp =
    paramIp ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";

  const isLocal = isLocalHost(clientIp);

  // On localhost, the server sees 127.0.0.1 — a loopback address that tells us
  // nothing about the user's real network. Fetch the real public IP server-side
  // using a multi-service fallback chain so geolocation returns correct ISP data.
  if (isLocal && !paramIp) {
    const realIp = await fetchRealPublicIp();
    if (realIp) clientIp = realIp;
  }

  // Parse coordinates if provided by client
  let latitude = clientLatParam ? parseFloat(clientLatParam) : null;
  let longitude = clientLonParam ? parseFloat(clientLonParam) : null;
  let city = clientCityParam || "";
  let region = clientRegionParam || "";
  let countryCode = clientCountryCodeParam || "";

  // If client provided precise coordinates, reverse geocode them to get correct city/region (if not already provided by client)
  if ((!city || !region || !countryCode) && latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude) && !(latitude === 0 && longitude === 0)) {
    try {
      const geoRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
      );
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        city = geoData.city || geoData.locality || "";
        region = geoData.principalSubdivision || "";
        countryCode = geoData.countryCode || "";
      }
    } catch (err) {
      console.error("Reverse geocoding failed: [coordinates redacted for privacy]");
    }
  }

  // 2. Geolocation parsing from Edge headers (Vercel / Cloudflare) or request.cf object
  const cf = (request as any).cf;
  const asn = headers.get("cf-asn") || cf?.asn?.toString() || "";
  let org =
    headers.get("cf-as-organization") ||
    cf?.asOrganization ||
    "Edge Network Provider";

  // Fall back to request headers / serverless cf object for coordinates and city if not resolved yet
  if (latitude === null || longitude === null) {
    const headerLat = headers.get("x-vercel-ip-latitude") || headers.get("cf-latitude") || cf?.latitude;
    const headerLon = headers.get("x-vercel-ip-longitude") || headers.get("cf-longitude") || cf?.longitude;
    latitude = headerLat ? parseFloat(headerLat) : null;
    longitude = headerLon ? parseFloat(headerLon) : null;
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

  // 3. Fallback to server-to-server lookup if coordinates are STILL missing
  let geoFallback = null as Awaited<ReturnType<typeof fetchServerGeo>> | null;
  if (latitude === null || longitude === null) {
    geoFallback = await fetchServerGeo(clientIp);
    if (geoFallback) {
      latitude = geoFallback.latitude;
      longitude = geoFallback.longitude;
      if (!city) city = geoFallback.city;
      if (!region) region = geoFallback.region;
      if (!countryCode) countryCode = geoFallback.countryCode;
      if (!org || org === "Edge Network Provider") org = geoFallback.org;
    }
  }

  // 4. Cross-check ISP against geo services — Cloudflare's cf-as-organization
  //    can be stale for some ASNs (e.g. ASN 9829 returns "NIB" instead of
  //    "Bharti Airtel"). Always query the geo services and prefer their result
  //    if it differs, since they tend to have more up-to-date ISP data.
  //    Reuses the step 3 result if available to avoid a duplicate API call.
  if (!geoFallback) {
    geoFallback = await fetchServerGeo(clientIp);
  }
  if (geoFallback) {
    const prevOrg = org;
    if (geoFallback.org && geoFallback.org !== "Edge Network Provider") {
      org = geoFallback.org;
    }
    if (!city || city === "Unknown City") city = geoFallback.city;
    if (!region || region === "Unknown Region") region = geoFallback.region;
    if (!countryCode || countryCode === "Unknown") countryCode = geoFallback.countryCode;
  }

  // Translate 2-letter country code into full English country name
  let countryName = "Unknown Country";
  if (countryCode) {
    const code = countryCode.toString().toUpperCase().trim();
    if (code.length === 2) {
      try {
        const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
        countryName = regionNames.of(code) || code;
      } catch (_) {
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
      // Don't return raw GPS coordinates for privacy
      latitude: undefined,
      longitude: undefined,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...NO_CACHE_HEADERS,
      },
    },
  );
};
