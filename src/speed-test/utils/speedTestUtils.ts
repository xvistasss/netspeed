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

// Median Absolute Deviation — robust measure of variability
// Used for outlier detection: samples > MAD * threshold are considered outliers
export const calculateMAD = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const med = calculateMedian(arr);
  const absDiffs = arr.map((v) => Math.abs(v - med));
  return calculateMedian(absDiffs);
};

// Remove outliers beyond N * MAD from the median.
// More robust than σ-based filtering because MAD is resistant to outliers itself.
export const removeOutliers = (arr: number[], threshold: number = 3): number[] => {
  if (arr.length <= 3) return arr; // Too few samples to filter
  const mad = calculateMAD(arr);
  if (mad === 0) return arr; // No variation — nothing to filter
  const med = calculateMedian(arr);
  const madThreshold = mad * threshold;
  return arr.filter((v) => Math.abs(v - med) <= madThreshold);
};

// Filtered RMS jitter — removes outliers before calculating RFC 3550 jitter.
// Eliminates GC pauses, OS scheduler hiccups, and transient spikes
// that inflate raw jitter on browser-based measurements.
export const calculateFilteredJitter = (arr: number[], sigma: number = 3): number => {
  const filtered = removeOutliers(arr, sigma);
  return calculateJitterRMS(filtered);
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

// WebRTC Data Channel echo measurement — measures UDP round-trip time.
// Creates two peer connections in a loopback configuration and exchanges
// data channel messages. The RTT measured over the data channel reflects
// the UDP transport latency through the browser's WebRTC stack, which
// avoids TCP handshake, TLS, and HTTP framing overhead.
//
// Returns the trimmed mean RTT from 10 echo pings (more representative than min),
// or null if unavailable.
export async function measureWebRTCSTUN(timeoutMs: number = CONFIG.WEBRTC_TIMEOUT_MS): Promise<number | null> {
  if (typeof RTCPeerConnection === "undefined") return null;

  try {
    const pc1 = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const pc2 = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Exchange ICE candidates between the two peers
    pc1.onicecandidate = (e) => {
      if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {});
    };
    pc2.onicecandidate = (e) => {
      if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {});
    };

    // Create data channel on pc1
    const dc = pc1.createDataChannel("echo");

    // Wait for the data channel to open on pc2
    const dcOpenPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Data channel open timeout")), timeoutMs);
      pc2.ondatachannel = (e) => {
        const remoteDc = e.channel;
        // Echo back any received message
        remoteDc.onmessage = (ev) => {
          try { remoteDc.send(ev.data); } catch (_) {}
        };
      };
      dc.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    // Create offer and answer
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(pc1.localDescription!);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(pc2.localDescription!);

    // Wait for data channel to open
    await dcOpenPromise;

    // Send 10 echo pings and measure round-trip times
    // Increased from 5 to 10 for statistical significance
    const rtts: number[] = [];
    for (let i = 0; i < CONFIG.WEBRTC_PING_COUNT; i++) {
      const rtt = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Echo timeout")), CONFIG.WEBRTC_ECHO_TIMEOUT_MS);
        dc.onmessage = () => {
          clearTimeout(timer);
          resolve(performance.now() - pingStart);
        };
        const pingStart = performance.now();
        dc.send("ping");
      });
      rtts.push(rtt);
      await new Promise(r => setTimeout(r, CONFIG.WEBRTC_PING_INTERVAL_MS));
    }

    // Clean up
    dc.close();
    pc1.close();
    pc2.close();

    // Return trimmed mean RTT — more representative than minimum.
    // Trimmed mean discards top/bottom 10% of samples, eliminating outliers
    // while preserving the central tendency. This matches how HTTP RTT is reported.
    return calculateTrimmedMean(rtts, 0.1);
  } catch (_) {
    return null;
  }
}

// ── Direct Cloudflare Latency URL Builder ──
// Builds URLs for latency/ping/packet-loss measurements against Cloudflare's
// speed test endpoint (__down?bytes=1). Uses the same CLOUDFLARE_SPEED_ENDPOINT
// as download/upload for consistency. The tiny 1-byte payload has negligible
// transfer time — the measurement is pure RTT.
import { CONFIG } from "./speedTestConfig";

export function buildDirectLatencyUrl(cacheBuster?: string): string {
  const cb = cacheBuster || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=${cb}`;
}

// ── ICMP Estimate Calculator ──
// Fixed-offset model: ICMP_RTT = HTTP_RTT - FIXED_OVERHEAD_MS
//
// TLS 1.3 + HTTP/2 framing on a reused connection adds ~2-6ms total round-trip.
// This is a constant additive overhead, NOT proportional to RTT.
// A multiplicative factor (e.g., 0.85) is mathematically wrong because:
//   - At 20ms HTTP RTT: factor 0.85 gives 17ms (correct, actual ~17ms)
//   - At 80ms HTTP RTT: factor 0.85 gives 68ms (wrong, actual ~77ms)
//   - At 5ms HTTP RTT (fiber): factor 0.85 gives 4.25ms (wrong, actual ~2ms)
//
// Fixed offset is accurate across all RTT ranges.
// Prefers WebRTC (UDP) when available — it's the closest to ICMP.
export function calculateICMPEstimate(
  httpRtt: number,
  webrtcRtt: number | null,
  networkType?: string,
): number {
  // Tier 1: Prefer WebRTC RTT — it's UDP-based and closest to ICMP.
  // Bypasses all TCP/TLS/HTTP overhead since it's a raw DataChannel echo.
  if (webrtcRtt !== null && webrtcRtt > 0) {
    return webrtcRtt;
  }

  // Tier 2: Fixed offset based on network type.
  // TLS 1.3 + HTTP/2 framing on a reused connection adds ~2-6ms constant
  // additive overhead (NOT proportional to RTT). WiFi/fiber has lower CPU
  // overhead; cellular adds carrier NAT + radio-layer processing.
  if (httpRtt <= 0) return 0;

  const isCellular = networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" || networkType === "3g" || networkType === "2g";

  const offsetMs = isCellular
    ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS
    : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;

  return Math.max(0, httpRtt - offsetMs);
}

// ── Network-Type-Aware Loaded Ping Interval ──
// Returns the appropriate background ping interval during data transfer.
// Cellular networks need longer intervals to avoid self-congestion.
export function getLoadedPingInterval(networkType?: string): number {
  const isCellular = networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" || networkType === "3g" || networkType === "2g";

  return isCellular
    ? CONFIG.LOADED_PING_INTERVAL_CELLULAR_MS
    : CONFIG.LOADED_PING_INTERVAL_WIFI_MS;
}

// ── Network-Type-Aware Packet Loss Interval ──
// Returns the appropriate interval between packet loss pings.
// Cellular networks benefit from shorter intervals to detect burst loss.
export function getPacketLossInterval(networkType?: string): number {
  const isCellular = networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" || networkType === "3g" || networkType === "2g";

  return isCellular
    ? CONFIG.PACKET_LOSS_INTERVAL_CELLULAR_MS
    : CONFIG.PACKET_LOSS_INTERVAL_WIFI_MS;
}

