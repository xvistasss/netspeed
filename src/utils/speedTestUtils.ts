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
  error?: string;  // Error message if the request failed (e.g., "HTTP 502", "timeout", "cancelled")
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
// For small arrays (≤10 samples), use median instead — more robust for small N.
export const calculateTrimmedMean = (arr: number[], trimPercent: number = 0.1): number => {
  if (arr.length === 0) return 0;
  if (arr.length <= 10) return calculateMedian(arr); // Use median for small samples (more robust)
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
  let sumSquaredDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (arr.length - 1));
};

// RFC 3550 RMS jitter calculation - more sensitive to large spikes
// This is the standard jitter metric used in VoIP and real-time applications
export const calculateJitterRMS = (arr: number[]): number => {
  if (arr.length <= 1) return 0;
  let sumSquaredDiffs = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  return Math.sqrt(sumSquaredDiffs / (arr.length - 1));
};

// MASD jitter (Mean Absolute Successive Differences) - kept for backward compat
// More robust to outliers than RMS but less sensitive to large spikes
export const calculateJitterMASD = (arr: number[]): number => {
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
  // Use N-1 for sample standard deviation (Bessel's correction)
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / (arr.length - 1));
};

export const calculatePercentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
};

// Adaptive upload stream count — more conservative than download because
// mobile upload is typically 5-10x slower than download. Uses the actual
// measured download speed as a reference, with stricter thresholds.
export const getUploadStreamCount = (
  downloadBps: number,
  measuredUploadBps: number | null,
): number => {
  // If we have measured upload speed from warmup, use it directly
  const estimate = measuredUploadBps && measuredUploadBps > 0
    ? measuredUploadBps
    : downloadBps * 0.2; // Upload is typically 20% of download on mobile

  if (estimate <= 0) return 2;
  if (estimate < 2_000_000) return 1;   // < 2 Mbps: single stream
  if (estimate < 5_000_000) return 2;   // < 5 Mbps: 2 streams
  if (estimate < 20_000_000) return 3;  // < 20 Mbps: 3 streams
  if (estimate < 50_000_000) return 4;  // < 50 Mbps: 4 streams
  return 6;                              // >= 50 Mbps: 6 streams
};

// Adaptive upload chunk minimum — scales down on slow connections to ensure
// requests complete within the phase timeout window.
export const getAdaptiveUploadMinChunk = (estimatedBps: number): number => {
  if (estimatedBps <= 0) return 64 * 1024;
  // Target ~500ms per chunk at minimum for smooth progress
  const targetBytes = (estimatedBps * 0.5) / 8;
  return Math.max(16 * 1024, Math.min(256 * 1024, Math.floor(targetBytes)));
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

// Exponential moving average for smoothing speed readings
export const calculateExponentialMovingAverage = (arr: number[], alpha: number = 0.3): number => {
  if (arr.length === 0) return 0;
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) {
    ema = alpha * arr[i] + (1 - alpha) * ema;
  }
  return ema;
};

// Generate non-compressible random text payload for upload tests.
// Must return a string (not Uint8Array) to avoid CORS preflight —
// Cloudflare's __up endpoint rejects OPTIONS requests.
// Uses printable ASCII characters (33-126) for true random content.
const RANDOM_BLOCK_SIZE = 65536;
let randomBlockCache: string | null = null;
function getRandomBlock(): string {
  if (randomBlockCache && randomBlockCache.length === RANDOM_BLOCK_SIZE) return randomBlockCache;
  const chars = new Array<string>(RANDOM_BLOCK_SIZE);
  for (let i = 0; i < RANDOM_BLOCK_SIZE; i++) {
    chars[i] = String.fromCharCode(33 + (Math.random() * 94 | 0));
  }
  randomBlockCache = chars.join("");
  return randomBlockCache;
}
export function generateRandomText(size: number): string {
  const block = getRandomBlock();
  if (size <= RANDOM_BLOCK_SIZE) return block.slice(0, size);
  const fullBlocks = (size / RANDOM_BLOCK_SIZE) | 0;
  const remainder = size - fullBlocks * RANDOM_BLOCK_SIZE;
  let result = block.repeat(fullBlocks);
  if (remainder > 0) result += block.slice(0, remainder);
  return result;
}

// Detect IPv4 vs IPv6 connectivity
export async function detectIPv4vsIPv6(): Promise<"ipv4" | "ipv6" | "dual"> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const ip = data.ip || "";
      if (ip.includes(":")) return "ipv6";
      return "ipv4";
    }
  } catch (_) {
    // Fallback: assume dual stack
  }
  return "dual";
}

// WebRTC STUN measurement — measures UDP round-trip time to a public STUN server.
// This is much closer to ICMP ping than HTTP RTT because both use UDP/ICMP
// (connectionless) protocols, avoiding TCP handshake and TLS overhead.
// Returns latency in ms, or null if WebRTC is unavailable or measurement fails.
export async function measureWebRTCSTUN(timeoutMs: number = 5000): Promise<number | null> {
  if (typeof RTCPeerConnection === "undefined") return null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { pc.close(); } catch (_) {}
      resolve(null);
    }, timeoutMs);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const startTime = performance.now();

    pc.onicecandidate = (event) => {
      if (event.candidate === null) {
        // ICE gathering complete — all candidates resolved
        const elapsed = performance.now() - startTime;
        clearTimeout(timer);
        try { pc.close(); } catch (_) {}
        resolve(elapsed);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        clearTimeout(timer);
        try { pc.close(); } catch (_) {}
        resolve(null);
      }
    };

    // Create a dummy data channel to trigger ICE gathering
    pc.createDataChannel("ping");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timer);
        try { pc.close(); } catch (_) {}
        resolve(null);
      });
  });
}

