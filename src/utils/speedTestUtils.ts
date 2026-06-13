// Configured array of globally distributed test servers
export interface TestServer {
  id: string;
  name: string;
  lat: number;
  lon: number;
  url: string; // Will default to current host API endpoints
  region?: string;
  distance: number;
}

// Haversine Math to calculate distance between two coordinates in km
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper to delay execution
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type TestPhase =
  | "idle"
  | "routing"
  | "ping"
  | "download"
  | "upload"
  | "complete"
  | "error";

export interface LatencyStats {
  current: number;
  avg: number;
  jitter: number;
  min: number;
  max: number;
  latencies: number[];
}

export interface SpeedStats {
  current: number; // bps
  avg: number; // bps
  peak: number; // bps
}

export interface ClientInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
  latitude: number;
  longitude: number;
  isLocal: boolean;
}

export interface DetailPingStats {
  sent: number;
  lost: number;
  latencies: number[];
}

// Statistical calculation helpers
export const calculateMean = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
};

export const calculateMedian = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const calculateMin = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return Math.min(...arr);
};

export const calculateMax = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return Math.max(...arr);
};

export const calculateJitter = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    sumDiffs += Math.abs(arr[i] - arr[i - 1]);
  }
  return sumDiffs / (arr.length - 1);
};

// Convert bits to string helper (standard decimal base-10 network metrics)
export const formatSpeed = (bps: number) => {
  const mbps = bps / 1000000;
  if (mbps >= 1000) {
    return { value: (mbps / 1000).toFixed(1), unit: "Gbps" };
  }
  return { value: mbps.toFixed(1), unit: "Mbps" };
};
