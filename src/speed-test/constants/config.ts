/**
 * Centralized configuration constants for the speed test engine.
 * Single Source of Truth (SSOT)
 */

export const CONFIG = {
  // Direct Cloudflare endpoint for download/upload/latency/packet-loss tests.
  CLOUDFLARE_SPEED_ENDPOINT: "https://speed.cloudflare.com",

  // Server-side proxy that forwards requests to speed.cloudflare.com.
  SPEED_PROXY_ENDPOINT: "/api/speed-proxy",

  // Ping Test
  PING_ITERATIONS: 35,
  PING_INTERVAL_MS: 80,

  // Download Test
  DOWNLOAD_DURATION_MS: 20_000,
  DOWNLOAD_WARMUP_MS: 1_500,
  DOWNLOAD_RAMP_MS: 2_500,
  DOWNLOAD_MEASURE_MS: 10_000,
  DOWNLOAD_PEAK_MS: 3_000,
  DOWNLOAD_STREAM_BYTES: 500 * 1024 * 1024,

  // Phase display sizes for UI categorization
  DOWNLOAD_PHASE_WARMUP_SIZE: 100 * 1024,
  DOWNLOAD_PHASE_RAMP_SIZE: 1 * 1024 * 1024,
  DOWNLOAD_PHASE_MEASURE_SIZE: 10 * 1024 * 1024,
  DOWNLOAD_PHASE_PEAK_SIZE: 25 * 1024 * 1024,

  // Upload Test
  UPLOAD_DURATION_MS: 20_000,
  UPLOAD_WARMUP_MS: 1_500,
  UPLOAD_RAMP_MS: 2_500,
  UPLOAD_MEASURE_MS: 10_000,
  UPLOAD_PEAK_MS: 3_000,
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 2 * 1024 * 1024,
  UPLOAD_SPEED_ESTIMATE_INIT: 1_000_000,
  UPLOAD_SLOW_THRESHOLD: 2_000_000,
  UPLOAD_SLOW_STREAMS: 2,
  UPLOAD_SLOW_MEASURE_MS: 15_000,
  UPLOAD_FETCH_TIMEOUT_MS: 30_000,

  // Parallelism
  PARALLEL_STREAMS_DEFAULT: 6,

  // Loaded Latency Pinger
  LOADED_PING_INTERVAL_MS: 200,
  LOADED_PING_INTERVAL_CELLULAR_MS: 300,
  LOADED_PING_INTERVAL_WIFI_MS: 100,

  // ICMP Estimation
  ICMP_OVERHEAD_FIXED_WIFI_MS: 3,
  ICMP_OVERHEAD_FIXED_CELLULAR_MS: 5,

  // Outlier Filtering
  JITTER_OUTLIER_SIGMA: 3,

  // Packet Loss Test
  PACKET_LOSS_PINGS: 100,
  PACKET_LOSS_INTERVAL_MS: 150,
  PACKET_LOSS_INTERVAL_CELLULAR_MS: 100,
  PACKET_LOSS_INTERVAL_WIFI_MS: 150,

  // Download Bin Sizes
  DOWNLOAD_BINS: [
    { name: "100 kB", minBytes: 0, maxBytes: 500 * 1024 },
    { name: "1 MB", minBytes: 500 * 1024, maxBytes: 5 * 1024 * 1024 },
    { name: "10 MB", minBytes: 5 * 1024 * 1024, maxBytes: 15 * 1024 * 1024 },
    { name: "25 MB", minBytes: 15 * 1024 * 1024, maxBytes: Infinity },
  ] as const,

  // Upload Bin Sizes
  UPLOAD_BINS: [
    { name: "< 500 kB", minBytes: 0, maxBytes: 500 * 1024 },
    { name: "1 MB", minBytes: 500 * 1024, maxBytes: 5 * 1024 * 1024 },
    { name: "10 MB", minBytes: 5 * 1024 * 1024, maxBytes: 15 * 1024 * 1024 },
    { name: "25 MB", minBytes: 15 * 1024 * 1024, maxBytes: Infinity },
  ] as const,

  // Retry
  MAX_CHUNK_RETRIES: 2,
  CHUNK_RETRY_DELAY_MS: 100,

  // Charts
  CHART_MAX_POINTS: 200,

  // Geo Services
  GEO_SERVICE_TIMEOUT_MS: 3000,

  // Dynamic Warmup
  DYNAMIC_WARMUP_MIN_MS: 1_500,
  DYNAMIC_WARMUP_MAX_MS: 8_000,
  DYNAMIC_RAMP_MIN_MS: 2_500,
  DYNAMIC_RAMP_MAX_MS: 8_000,

  // WebRTC UDP Latency Measurement
  WEBRTC_PING_COUNT: 20,
  WEBRTC_PING_INTERVAL_MS: 50,
  WEBRTC_TIMEOUT_MS: 8_000,
  WEBRTC_ECHO_TIMEOUT_MS: 2_000,
  STUN_SERVERS: [{ urls: "stun:stun.l.google.com:19302" }] as const,

  // Synchronization Barrier
  SYNC_BARRIER_STABLE_MS: 250,
  SYNC_BARRIER_POLL_MS: 50,

  // CLI overrides
  CLI_OVERRIDES: {
    PING_ITERATIONS: 15,
    PING_INTERVAL_MS: 60,
    PARALLEL_STREAMS: 1,
    PACKET_LOSS_PINGS: 50,
    PACKET_LOSS_INTERVAL_MS: 100,
  } as const,
} as const;
