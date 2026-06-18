// Centralized configuration constants for the speed test engine.
// All magic numbers extracted here for maintainability and tuning.

export const CONFIG = {
  // ── Ping Test ──
  PING_ITERATIONS: 15,
  PING_INTERVAL_MS: 60,

  // ── Download Test ──
  DOWNLOAD_DURATION_MS: 20_000,
  DOWNLOAD_MEASUREMENT_START_SEC: 1.5,

  // Sequential phase durations (ms) — measurement phase extended for TCP steady state
  DOWNLOAD_WARMUP_MS: 1_500,
  DOWNLOAD_RAMP_MS: 2_500,
  DOWNLOAD_MEASURE_MS: 10_000,
  DOWNLOAD_PEAK_MS: 3_000,

  // Phase target sizes (bytes) — each phase requests this exact payload
  CHUNK_WARMUP: 100 * 1024,
  CHUNK_RAMP: 1 * 1024 * 1024,
  CHUNK_MEASURE: 10 * 1024 * 1024,
  CHUNK_PEAK: 25 * 1024 * 1024,

  // ── Upload Test ──
  UPLOAD_DURATION_MS: 20_000,
  UPLOAD_WARMUP_MS: 1_500,
  UPLOAD_RAMP_MS: 2_500,
  UPLOAD_MEASURE_MS: 10_000,
  UPLOAD_PEAK_MS: 3_000,

  // Upload chunk sizing — reduced max to minimize ArrayBuffer serialization overhead
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 2 * 1024 * 1024,
  UPLOAD_SPEED_ESTIMATE_INIT: 1_000_000,

  // ── Parallelism ──
  PARALLEL_STREAMS_DEFAULT: 6,
  PARALLEL_STREAMS_SLOW: 2,
  PARALLEL_STREAMS_MEDIUM: 4,
  PARALLEL_STREAMS_FAST: 6,
  // Bandwidth thresholds (bps) for adaptive stream selection
  BANDWIDTH_SLOW_THRESHOLD: 10_000_000,   // < 10 Mbps
  BANDWIDTH_MEDIUM_THRESHOLD: 100_000_000, // < 100 Mbps

  // ── Loaded Latency Pinger ──
  LOADED_PING_INTERVAL_MS: 200,

  // ── Packet Loss Test ──
  PACKET_LOSS_PINGS: 50,
  PACKET_LOSS_INTERVAL_MS: 100,

  // ── Retry ──
  MAX_CHUNK_RETRIES: 2,
  CHUNK_RETRY_DELAY_MS: 100,

  // ── Charts ──
  CHART_MAX_POINTS: 200,

  // ── Routing ──
  ROUTE_PROBE_COUNT: 3,
  ROUTE_PROBE_TIMEOUT_MS: 1200,
  ROUTE_CLOSEST_CANDIDATES: 5,

  // ── Geo Services ──
  GEO_SERVICE_TIMEOUT_MS: 3000,

  // ── Dynamic Warmup (TCP BDP) ──
  // Warmup duration scales with measured bandwidth-delay product
  DYNAMIC_WARMUP_MIN_MS: 1_500,
  DYNAMIC_WARMUP_MAX_MS: 5_000,
  DYNAMIC_RAMP_MIN_MS: 2_500,
  DYNAMIC_RAMP_MAX_MS: 5_000,
} as const;
