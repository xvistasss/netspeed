import { CONFIG } from "../../constants";
import { sleep, calculateFilteredJitter } from "../../utils";

export interface PingRunnerOptions {
  baseUrl?: string;
  region?: string;
  serverId?: string;
  clientLat?: number;
  clientLon?: number;
  networkType?: string;
  signal: AbortSignal;
  postMessage: (msg: any) => void;
  isCancelled: () => boolean;
}

/**
 * Ping and Jitter Test Runner
 * Measures HTTP-level RTT directly against Cloudflare edge infrastructure.
 */
export async function runPingTest(options: PingRunnerOptions): Promise<void> {
  const { signal, postMessage, isCancelled } = options;
  const iterations = CONFIG.PING_ITERATIONS;
  const latencies: number[] = [];
  let jitter = 0;
  let pingSent = 0;
  let pingLost = 0;

  // 1. Connection Warm-up - 4 rapid requests to establish HTTP/2 connection
  try {
    for (let w = 0; w < 4; w++) {
      const res = await fetch(
        `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=warmup-${w}-${Date.now()}`,
        {
          method: "GET",
          cache: "no-store",
          signal,
        },
      );
      if (res.status !== 204) {
        await res.text();
      }
    }
  } catch (_) {
    // Warmup failures are ignored
  }

  // 2. Real latency measurements
  for (let i = 0; i < iterations; i++) {
    if (isCancelled() || signal.aborted) break;

    pingSent++;
    let measurementCompleted = false;

    // Retry logic: try up to 2 times for each ping measurement
    for (let retry = 0; retry < 2 && !measurementCompleted; retry++) {
      const start = performance.now();
      try {
        const suffix = `ping-${i}${retry > 0 ? `-retry${retry}` : ""}-${Date.now()}`;
        const response = await fetch(
          `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=${suffix}`,
          {
            method: "GET",
            cache: "no-store",
            signal,
          },
        );

        if (!response.ok) {
          throw new Error("Ping request failed");
        }

        if (response.status !== 204) {
          await response.text();
        }

        const latency = performance.now() - start;
        latencies.push(latency);

        jitter = calculateFilteredJitter(latencies, CONFIG.JITTER_OUTLIER_SIGMA);

        postMessage({
          type: "PING_PROGRESS",
          iteration: i + 1,
          totalIterations: iterations,
          latency,
          jitter,
          latencies: [...latencies],
          pingSent,
          pingLost,
          avgIcmpEquivalent: 0,
        });

        measurementCompleted = true;
      } catch (err) {
        if (signal.aborted) throw err;

        if (retry === 1) {
          pingLost++;
          postMessage({
            type: "PING_FAILED_ITERATION",
            iteration: i + 1,
            pingSent,
            pingLost,
          });
        } else {
          await sleep(20);
        }
      }
    }

    await sleep(80);
  }

  const finalJitter = calculateFilteredJitter(latencies, CONFIG.JITTER_OUTLIER_SIGMA);

  postMessage({
    type: "PING_COMPLETE",
    latencies,
    jitter: finalJitter,
    pingSent,
    pingLost,
    avgIcmpEquivalent: 0,
  });
}
