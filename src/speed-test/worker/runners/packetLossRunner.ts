import { CONFIG } from "../../constants";
import { sleep, getPacketLossInterval } from "../../utils";

export interface PacketLossRunnerOptions {
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
 * Dedicated Packet Loss Test Runner
 * Sends rapid pings to Cloudflare speed endpoint to measure network-level packet loss.
 */
export async function runPacketLossTest(options: PacketLossRunnerOptions): Promise<void> {
  const { networkType, signal, postMessage, isCancelled } = options;
  const totalPings = CONFIG.PACKET_LOSS_PINGS;
  const intervalMs = getPacketLossInterval(networkType);
  let sent = 0;
  let lost = 0;

  // 1. Warm-up - establish connection before loss measurement
  try {
    const warmupRes = await fetch(
      `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=pl-warmup-${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
        signal,
      },
    );
    if (warmupRes.status !== 204) {
      await warmupRes.text();
    }
  } catch (_) {
    // Warmup failure doesn't invalidate the test
  }

  // 2. Measure packet loss
  for (let i = 0; i < totalPings; i++) {
    if (isCancelled() || signal.aborted) break;

    sent++;
    try {
      const res = await fetch(
        `${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1&cb=pl-${i}-${Date.now()}`,
        {
          method: "GET",
          cache: "no-store",
          signal,
        },
      );

      if (res.ok) {
        if (res.status !== 204) {
          await res.text();
        }
      } else {
        lost++;
      }
    } catch (err: any) {
      if (err.name === "AbortError" || isCancelled()) {
        break;
      }
      lost++;
    }

    postMessage({
      type: "PACKET_LOSS_PROGRESS",
      iteration: i + 1,
      totalIterations: totalPings,
      sent,
      lost,
    });

    if (i < totalPings - 1) {
      await sleep(intervalMs);
    }
  }

  const lossPercent = sent > 0 ? (lost / sent) * 100 : 0;

  postMessage({
    type: "PACKET_LOSS_COMPLETE",
    sent,
    lost,
    lossPercent,
    serverErrors: 0,
    lossBreakdown: { timeout: 0, reset: 0, serverError: 0 },
  });
}
