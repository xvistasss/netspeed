export interface SpeedTestRequest {
  time: number;
  direction: "download" | "upload";
  bytes: number;
  payloadSize: number;
  phaseSize: number;
  latency: number;
  bps: number;
  duration: number;
  serverTime: number;
  responseSize: number;
  loadedLatencies: number[];
}

// Helper to delay execution
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Abort-aware sleep — resolves early if the signal fires before the timer
export const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export type TestPhase =
  | "idle"
  | "routing"
  | "ping"
  | "download"
  | "upload"
  | "packetLoss"
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
  isPrecise?: boolean;
  connectionType?: string;    // e.g. "wifi", "ethernet", "cellular", "unknown"
  effectiveType?: string;     // e.g. "4g", "3g", "2g", "slow-2g"
  downlink?: number;          // Mbps estimate from Network Information API
  rtt?: number;               // ms estimate from Network Information API
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

// Trimmed mean: discard top and bottom 10% of samples before averaging.
// This eliminates GC pauses, OS scheduler hiccups, and transient spikes
// that inflate the raw mean. Standard practice for latency measurement.
export const calculateTrimmedMean = (arr: number[], trimPercent: number = 0.1): number => {
  if (arr.length === 0) return 0;
  if (arr.length <= 3) return calculateMean(arr); // too few samples to trim
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.max(1, Math.floor(sorted.length * trimPercent));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) return calculateMean(arr);
  return trimmed.reduce((sum, val) => sum + val, 0) / trimmed.length;
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
  return arr.reduce((min, val) => (val < min ? val : min), arr[0]);
};

export const calculateMax = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  return arr.reduce((max, val) => (val > max ? val : max), arr[0]);
};

export const calculateJitter = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    sumDiffs += Math.abs(arr[i] - arr[i - 1]);
  }
  return sumDiffs / (arr.length - 1);
};

export const calculateStdDev = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  const mean = calculateMean(arr);
  const squaredDiffs = arr.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / arr.length);
};

export const calculatePercentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
};

// Adaptive parallel stream count based on measured bandwidth.
// Slower connections use fewer streams to avoid buffer bloat and
// accurately represent real-world single/multi-connection performance.
export const getAdaptiveStreamCount = (
  estimatedBps: number,
  defaultCount: number,
  slowThreshold: number,
  mediumThreshold: number,
  slowCount: number = 2,
  mediumCount: number = 4,
  fastCount: number = 6,
): number => {
  if (estimatedBps <= 0) return defaultCount;
  if (estimatedBps < slowThreshold) return slowCount;
  if (estimatedBps < mediumThreshold) return mediumCount;
  return fastCount;
};

// Convert bits to string helper (standard decimal base-10 network metrics)
export const formatSpeed = (bps: number) => {
  const mbps = bps / 1000000;
  if (mbps >= 1000) {
    return { value: (mbps / 1000).toFixed(1), unit: "Gbps" };
  }
  return { value: mbps.toFixed(1), unit: "Mbps" };
};

// Helper to check for local loopback or private range IPs / Hostnames / URLs
// Used to determine if we should proxy to Cloudflare for real throughput measurement
export function isLocalHost(value: string | null | undefined): boolean {
  if (!value) return false;
  let hostname = value;
  if (value.includes("://")) {
    try {
      hostname = new URL(value).hostname;
    } catch (_) {
      // ignore
    }
  } else {
    // If it contains a port, strip it
    hostname = value.split(":")[0];
  }
  hostname = hostname.toLowerCase().trim();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  );
}

