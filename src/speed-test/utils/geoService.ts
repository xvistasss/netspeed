import type { ClientInfo } from "../types";
import { haversineDistance } from "./serverSelection";

export interface ReverseGeocodeResult {
  city: string;
  region: string;
  countryCode: string;
}

export async function fetchReverseGeocode(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult> {
  let city = "";
  let region = "";
  let countryCode = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: controller.signal, cache: "no-store" },
    );
    clearTimeout(timeout);
    if (res.ok) {
      const bdcData = await res.json();
      city = bdcData.city || bdcData.locality || "";
      region = bdcData.principalSubdivision || "";
      countryCode = bdcData.countryCode || "";
    }
  } catch {
    // Non-critical fallback
  }
  return { city, region, countryCode };
}

export async function fetchIpLocation(): Promise<ClientInfo> {
  const fallback: ClientInfo = {
    ip: "Unknown",
    city: "Unknown",
    region: "Unknown",
    country: "Unknown",
    org: "Unknown",
    latitude: 0,
    longitude: 0,
    isLocal: false,
    isPrecise: false,
    isApproximate: true,
  };

  try {
    const geoRes = await fetch("/api/ip-geo", { cache: "no-store" });
    if (geoRes.ok) {
      const data = await geoRes.json();
      return {
        ...fallback,
        ...data,
      };
    }
  } catch {
    // Fallback on network failure
  }
  return fallback;
}

export function readNetworkInformation(): Partial<ClientInfo> {
  const info: Partial<ClientInfo> = {};
  if (typeof navigator !== "undefined" && "connection" in navigator) {
    const conn = (navigator as any).connection;
    if (conn) {
      info.effectiveType = conn.effectiveType || undefined;
      info.downlink = conn.downlink || undefined;
      info.rtt = conn.rtt || undefined;
      if (conn.type) {
        info.connectionType = conn.type;
      } else if (conn.effectiveType) {
        const et = conn.effectiveType;
        if (et === "4g") info.connectionType = "cellular-4g";
        else if (et === "3g") info.connectionType = "cellular-3g";
        else if (et === "2g" || et === "slow-2g") info.connectionType = "cellular-2g";
        else info.connectionType = "unknown";
      }
    }
  }
  return info;
}

export function isGpsSuspicious(
  coords: { latitude: number; longitude: number; accuracy: number },
  existing: ClientInfo,
  countryCode?: string,
): boolean {
  if (coords.accuracy <= 200) return false;

  const ipLat = existing.latitude;
  const ipLon = existing.longitude;
  const distFromIp =
    ipLat !== 0 || ipLon !== 0
      ? haversineDistance(coords.latitude, coords.longitude, ipLat, ipLon)
      : 0;
  const gpsCountryLower = (countryCode || "").toLowerCase();
  const ipCountryLower = (existing.country || "").toLowerCase();
  const countriesMatch =
    gpsCountryLower && ipCountryLower && gpsCountryLower === ipCountryLower;

  return distFromIp > 200 && !countriesMatch;
}
