import type { APIRoute } from "astro";
import { isLocalHost } from "../../utils/speedTestUtils";


// Server-side fallback geolocation
async function fetchServerGeo(ip: string) {
  // 1. Try freeipapi.com
  try {
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.latitude === "number") {
        return {
          city: data.cityName || "Unknown City",
          region: data.regionName || "Unknown Region",
          countryCode: data.countryCode || "",
          latitude: data.latitude,
          longitude: data.longitude,
          org: "Edge Network Provider",
        };
      }
    }
  } catch (err) {
    console.error("Server-side freeipapi lookup failed:", err);
  }

  // 2. Try ipapi.co
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetSpeed/1.0)" }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.latitude === "number") {
        return {
          city: data.city || "Unknown City",
          region: data.region || "Unknown Region",
          countryCode: data.country || "",
          latitude: data.latitude,
          longitude: data.longitude,
          org: data.org || "Edge Network Provider",
        };
      }
    }
  } catch (err) {
    console.error("Server-side ipapi lookup failed:", err);
  }

  return null;
}

export const GET: APIRoute = async ({ request, url }) => {
  const headers = request.headers;
  const paramIp = url.searchParams.get("ip");
  const clientLatParam = url.searchParams.get("clientLat") || url.searchParams.get("lat");
  const clientLonParam = url.searchParams.get("clientLon") || url.searchParams.get("lon");
  const clientCityParam = url.searchParams.get("city");
  const clientRegionParam = url.searchParams.get("region");
  const clientCountryCodeParam = url.searchParams.get("countryCode") || url.searchParams.get("country");

  // 1. IP Detection (support client-provided query param as fallback/localhost override)
  const clientIp =
    paramIp ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";

  const isLocal = isLocalHost(clientIp);

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
      console.error("Reverse geocoding failed:", err);
    }
  }

  // Handle local connection short-circuit (only if no coordinates were passed)
  if (isLocal && (latitude === null || longitude === null)) {
    return new Response(
      JSON.stringify({
        isLocal: true,
        ip: clientIp,
        city: "Local Host",
        region: "Intranet",
        country: "Local",
        countryCode: "LO",
        loc: "0,0",
        org: "Local Network",
        latitude: 0,
        longitude: 0,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
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
  if (latitude === null || longitude === null) {
    const fallback = await fetchServerGeo(clientIp);
    if (fallback) {
      latitude = fallback.latitude;
      longitude = fallback.longitude;
      if (!city) city = fallback.city;
      if (!region) region = fallback.region;
      if (!countryCode) countryCode = fallback.countryCode;
      if (!org || org === "Edge Network Provider") org = fallback.org;
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
      loc: latitude !== null && longitude !== null ? `${latitude},${longitude}` : undefined,
      org: asn ? `AS${asn} ${org}` : org,
      latitude: latitude !== null ? latitude : undefined,
      longitude: longitude !== null ? longitude : undefined,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
};

