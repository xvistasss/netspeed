// Centralized configuration constants for the speed test engine.
// All magic numbers extracted here for maintainability and tuning.

export const CONFIG = {
  // ── Ping Test ──
  PING_ITERATIONS: 35,
  PING_INTERVAL_MS: 80,

  // ── Download Test ──
  // Streaming architecture: each parallel stream opens ONE long-lived connection
  // to Cloudflare and reads continuously. Phase timing is time-based, not chunk-based.
  DOWNLOAD_DURATION_MS: 20_000,

  // Sequential phase durations (ms)
  DOWNLOAD_WARMUP_MS: 1_500,
  DOWNLOAD_RAMP_MS: 2_500,
  DOWNLOAD_MEASURE_MS: 10_000,
  DOWNLOAD_PEAK_MS: 3_000,

  // Per-stream bytes: how much data to request per connection.
  // 500MB is enough for any realistic speed (even 10 Gbps for 20s = ~250MB).
  DOWNLOAD_STREAM_BYTES: 500 * 1024 * 1024,

  // Phase display sizes — virtual sizes for UI categorization.
  // After test completion, the worker synthesizes per-phase request entries
  // using these sizes so the DetailedMeasurements bins display correctly.
  DOWNLOAD_PHASE_WARMUP_SIZE: 100 * 1024,       // 100 kB
  DOWNLOAD_PHASE_RAMP_SIZE: 1 * 1024 * 1024,    // 1 MB
  DOWNLOAD_PHASE_MEASURE_SIZE: 10 * 1024 * 1024, // 10 MB
  DOWNLOAD_PHASE_PEAK_SIZE: 25 * 1024 * 1024,   // 25 MB

  // ── Upload Test ──
  // Upload uses adaptive chunk sizing (not streaming) because upload POST requests
  // complete per-chunk. Chunks are sent directly to Cloudflare's __up endpoint.
  UPLOAD_DURATION_MS: 20_000,
  UPLOAD_WARMUP_MS: 1_500,
  UPLOAD_RAMP_MS: 2_500,
  UPLOAD_MEASURE_MS: 10_000,
  UPLOAD_PEAK_MS: 3_000,

  // Upload chunk sizing — adaptive minimum scales down on slow connections.
  UPLOAD_MIN_CHUNK: 64 * 1024,
  UPLOAD_MAX_CHUNK: 2 * 1024 * 1024,
  UPLOAD_SPEED_ESTIMATE_INIT: 1_000_000,
  // Minimum upload speed threshold (bps) below which we use ultra-conservative settings
  UPLOAD_SLOW_THRESHOLD: 2_000_000,  // < 2 Mbps
  UPLOAD_SLOW_STREAMS: 2,
  UPLOAD_SLOW_MEASURE_MS: 15_000,  // Extended measurement for slow connections

  // Per-fetch timeout — prevents hanging requests on congested mobile networks
  UPLOAD_FETCH_TIMEOUT_MS: 30_000,

  // ── Parallelism ──
  // 6 streams for aggregate throughput measurement (industry standard — Ookla, Google).
  // Each stream opens one long-lived connection to Cloudflare's __down endpoint.
  // Total data = PARALLEL_STREAMS * perStreamBytes. Kept reasonable for mobile.
  PARALLEL_STREAMS_DEFAULT: 6,

  // ── Loaded Latency Pinger ──
  LOADED_PING_INTERVAL_MS: 200,

  // ── Packet Loss Test ──
  PACKET_LOSS_PINGS: 100,
  PACKET_LOSS_INTERVAL_MS: 150,

  // ── Retry ──
  MAX_CHUNK_RETRIES: 2,
  CHUNK_RETRY_DELAY_MS: 100,

  // ── Charts ──
  CHART_MAX_POINTS: 200,

  // ── Geo Services ──
  GEO_SERVICE_TIMEOUT_MS: 3000,

  // ── Dynamic Warmup (TCP BDP) ──
  // Warmup duration scales with measured bandwidth-delay product
  DYNAMIC_WARMUP_MIN_MS: 1_500,
  DYNAMIC_WARMUP_MAX_MS: 8_000,
  DYNAMIC_RAMP_MIN_MS: 2_500,
  DYNAMIC_RAMP_MAX_MS: 8_000,

  // ── CLI-specific overrides ──
  // CLI uses different values for backward compatibility and native network access
  CLI_OVERRIDES: {
    PING_ITERATIONS: 15,
    PING_INTERVAL_MS: 60,
    PARALLEL_STREAMS: 1,
    PACKET_LOSS_PINGS: 50,
    PACKET_LOSS_INTERVAL_MS: 100,
  } as const,
} as const;
