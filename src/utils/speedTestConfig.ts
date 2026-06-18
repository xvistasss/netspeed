// Centralized configuration constants for the speed test engine.
// All magic numbers extracted here for maintainability and tuning.

export const CONFIG = {
  // ── Ping Test ──
  PING_ITERATIONS: 15,
  PING_INTERVAL_MS: 60,

  // ── Download Test ──
  DOWNLOAD_DURATION_MS: 10_000,
  DOWNLOAD_MEASUREMENT_START_SEC: 1.5,

  // Sequential phase durations (ms) — mirrors upload structure
  DOWNLOAD_WARMUP_MS: 1_500,
  DOWNLOAD_RAMP_MS: 2_500,
  DOWNLOAD_MEASURE_MS: 3_500,
  DOWNLOAD_PEAK_MS: 2_500,

  // Phase target sizes (bytes) — each phase requests this exact payload
  CHUNK_WARMUP: 100 * 1024,
  CHUNK_RAMP: 1 * 1024 * 1024,
  CHUNK_MEASURE: 10 * 1024 * 1024,
  CHUNK_PEAK: 25 * 1024 * 1024,

  // ── Upload Test ──
  UPLOAD_DURATION_MS: 10_000,
  UPLOAD_WARMUP_MS: 1_500,
  UPLOAD_RAMP_MS: 2_500,
  UPLOAD_MEASURE_MS: 3_500,
  UPLOAD_PEAK_MS: 2_500,

  // Upload chunk sizing
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 5 * 1024 * 1024,
  UPLOAD_SPEED_ESTIMATE_INIT: 1_000_000,

  // ── Parallelism ──
  PARALLEL_STREAMS: 6,

  // ── Loaded Latency Pinger ──
  LOADED_PING_INTERVAL_MS: 200,
  LOADED_PING_MAX_ENTRIES: 50,

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

  // ── UI ──
  PROGRESS_BAR_RESOLUTION: 100,
} as const;
