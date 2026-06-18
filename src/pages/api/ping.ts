import type { APIRoute } from "astro";
import { SERVER_LIST } from "../../utils/serverListUtils";
import { sleep, estimateRtt } from "../../utils/speedTestUtils";

const corsHeaders = {
  "Content-Type": "text/plain",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Content-Encoding": "identity", // Turn off server-side Gzip / Brotli
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
};

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const region = url.searchParams.get("region");
    const serverId = url.searchParams.get("serverId");
    const clientLatParam = url.searchParams.get("clientLat");
    const clientLonParam = url.searchParams.get("clientLon");
    const isWarmup = url.searchParams.get("warmup") === "true";
    const hostLatencyParam = url.searchParams.get("hostLatency");
    const hostLatency = hostLatencyParam ? parseFloat(hostLatencyParam) : 0;

    // Parse client location from params or fallback to headers or request.cf object
    const headers = request.headers;
    const cf = (request as any).cf;
    const clientLat = clientLatParam
      ? parseFloat(clientLatParam)
      : parseFloat(
          headers.get("x-vercel-ip-latitude") ||
            headers.get("cf-latitude") ||
            cf?.latitude ||
            "0",
        );
    const clientLon = clientLonParam
      ? parseFloat(clientLonParam)
      : parseFloat(
          headers.get("x-vercel-ip-longitude") ||
              headers.get("cf-longitude") ||
              cf?.longitude ||
              "0",
        );

    // Find target server coordinates
    let serverLat = 0;
    let serverLon = 0;

    if (serverId || region) {
      const server = serverId
        ? SERVER_LIST.find((s) => s.id === serverId)
        : region
          ? SERVER_LIST.find((s) => s.region === region)
          : undefined;
      if (server) {
        serverLat = server.lat;
        serverLon = server.lon;
      }
    }

    // Calculate simulated target latency
    const targetLatency = estimateRtt(region, clientLat, clientLon, serverLat, serverLon, undefined, 20);

    // Calculate final sleep delay.
    let additionalDelay = 0;
    if (!isWarmup) {
      additionalDelay = Math.max(0, targetLatency - hostLatency);
    }

    if (additionalDelay > 0) {
      await sleep(additionalDelay);
    }

    // Return tiny payload with cache-control and content-encoding overrides
    return new Response("pong", {
      status: 200,
      headers: corsHeaders,
    });
  } catch (globalErr: any) {
    console.error("Global ping handler error:", globalErr);
    return new Response(globalErr?.message || "Internal server error during ping", {
      status: 500,
      headers: corsHeaders,
    });
  }
};

export const POST: APIRoute = GET; // Accept POST as well

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      "Access-Control-Max-Age": "86400",
    },
  });
};
