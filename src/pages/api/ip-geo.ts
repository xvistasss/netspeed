import type { APIRoute } from "astro";

// Helper to check for local loopback or private range IPs
const isLocalIp = (ip: string) => {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
};

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

  // 1. IP Detection (support client-provided query param as fallback/localhost override)
  const clientIp =
    paramIp ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";

  const isLocal = isLocalIp(clientIp);

  if (isLocal) {
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
  let latitude =
    headers.get("x-vercel-ip-latitude") ||
    headers.get("cf-latitude") ||
    cf?.latitude;
  let longitude =
    headers.get("x-vercel-ip-longitude") ||
    headers.get("cf-longitude") ||
    cf?.longitude;
  let city =
    headers.get("x-vercel-ip-city") ||
    headers.get("cf-ipcity") ||
    cf?.city;
  let countryCode =
    headers.get("x-vercel-ip-country") ||
    headers.get("cf-ipcountry") ||
    cf?.country;
  let region =
    headers.get("x-vercel-ip-country-region") ||
    headers.get("cf-region") ||
    cf?.region;
  const asn = headers.get("cf-asn") || cf?.asn?.toString() || "";
  let org =
    headers.get("cf-as-organization") ||
    cf?.asOrganization ||
    "Edge Network Provider";

  // 3. Fallback to server-to-server lookup if edge coordinates are missing
  if (!latitude || !longitude) {
    const fallback = await fetchServerGeo(clientIp);
    if (fallback) {
      latitude = fallback.latitude.toString();
      longitude = fallback.longitude.toString();
      city = fallback.city;
      region = fallback.region;
      countryCode = fallback.countryCode;
      org = fallback.org;
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
      isLocal: false,
      ip: clientIp,
      city: city || "Unknown City",
      region: region || "Unknown Region",
      country: countryName,
      countryCode: countryCode || "Unknown",
      loc: latitude && longitude ? `${latitude},${longitude}` : undefined,
      org: asn ? `AS${asn} ${org}` : org,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
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

