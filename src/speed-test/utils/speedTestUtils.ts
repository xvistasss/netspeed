import { CONFIG } from "../constants";
import type { IcmpEstimateResult } from "../types";


// Helper to delay execution
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Abort-aware sleep - resolves early if the signal fires before the timer
export const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// Adaptive upload stream count based on measured download speed
export const getUploadStreamCount = (
  downloadBps: number,
  measuredUploadBps: number | null,
): number => {
  const estimate =
    measuredUploadBps && measuredUploadBps > 0 ? measuredUploadBps : downloadBps * 0.2;

  if (estimate <= 0) return 2;
  if (estimate < 2_000_000) return 1;
  if (estimate < 5_000_000) return 2;
  if (estimate < 20_000_000) return 3;
  if (estimate < 50_000_000) return 4;
  return 6;
};

// Adaptive upload chunk minimum
export const getAdaptiveUploadMinChunk = (estimatedBps: number): number => {
  if (estimatedBps <= 0) return 64 * 1024;
  const targetBytes = (estimatedBps * 0.5) / 8;
  return Math.max(16 * 1024, Math.min(256 * 1024, Math.floor(targetBytes)));
};

// Format bits/sec to Mbps / Gbps
export const formatSpeed = (bps: number) => {
  const mbps = bps / 1_000_000;
  if (mbps >= 1000) {
    return { value: (mbps / 1000).toFixed(1), unit: "Gbps" };
  }
  return { value: mbps.toFixed(1), unit: "Mbps" };
};

// Check for local loopback or private range IPs
export function isLocalHost(value: string | null | undefined): boolean {
  if (!value) return false;
  let hostname = value;
  if (value.includes("://")) {
    try {
      hostname = new URL(value).hostname;
    } catch (_) {}
  } else {
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

// Exponential moving average for smoothing readings
export const calculateExponentialMovingAverage = (arr: number[], alpha: number = 0.3): number => {
  if (arr.length === 0) return 0;
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) {
    ema = alpha * arr[i] + (1 - alpha) * ema;
  }
  return ema;
};

// Generate non-compressible random text payload for upload tests
const RANDOM_BLOCK_SIZE = 65536;
let randomBlockCache: string | null = null;
function getRandomBlock(): string {
  if (randomBlockCache && randomBlockCache.length === RANDOM_BLOCK_SIZE) return randomBlockCache;
  const chars = new Array<string>(RANDOM_BLOCK_SIZE);
  for (let i = 0; i < RANDOM_BLOCK_SIZE; i++) {
    chars[i] = String.fromCharCode(33 + ((Math.random() * 94) | 0));
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
  } catch (_) {}
  return "dual";
}

// Latency URL Builder (via server-side proxy)
export function buildDirectLatencyUrl(cacheBuster?: string): string {
  const cb = cacheBuster || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${CONFIG.SPEED_PROXY_ENDPOINT}?bytes=1&cb=${cb}`;
}

// Direct Cloudflare URL Builder
export function buildDirectCloudflareUrl(
  endpoint: "/__down" | "/__up",
  bytes: number,
  cacheBuster?: string,
): string {
  const cb = cacheBuster || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}${endpoint}?bytes=${bytes}&cb=${cb}`;
}

// ICMP Estimate Calculator
export function calculateICMPEstimate(
  httpRtt: number,
  webrtcRtt: number | null,
  networkType?: string,
): IcmpEstimateResult {
  if (webrtcRtt !== null && webrtcRtt > 0) {
    return { value: webrtcRtt, source: "webrtc" };
  }

  if (httpRtt <= 0) return { value: 0, source: "http-fallback", offsetApplied: 0 };

  const isCellular =
    networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" ||
    networkType === "3g" ||
    networkType === "2g";

  const offsetMs = isCellular
    ? CONFIG.ICMP_OVERHEAD_FIXED_CELLULAR_MS
    : CONFIG.ICMP_OVERHEAD_FIXED_WIFI_MS;

  return {
    value: Math.max(0, httpRtt - offsetMs),
    source: "http-fallback",
    offsetApplied: offsetMs,
  };
}

// Network-Type-Aware Loaded Ping Interval
export function getLoadedPingInterval(networkType?: string): number {
  const isCellular =
    networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" ||
    networkType === "3g" ||
    networkType === "2g";

  return isCellular
    ? CONFIG.LOADED_PING_INTERVAL_CELLULAR_MS
    : CONFIG.LOADED_PING_INTERVAL_WIFI_MS;
}

// Network-Type-Aware Packet Loss Interval
export function getPacketLossInterval(networkType?: string): number {
  const isCellular =
    networkType === "cellular" ||
    networkType?.startsWith("cellular-") ||
    networkType === "4g" ||
    networkType === "3g" ||
    networkType === "2g";

  return isCellular
    ? CONFIG.PACKET_LOSS_INTERVAL_CELLULAR_MS
    : CONFIG.PACKET_LOSS_INTERVAL_WIFI_MS;
}
