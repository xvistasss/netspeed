import type { APIRoute } from "astro";

const corsHeaders = {
  "Content-Type": "text/plain",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
};

// The ping endpoint returns "pong" immediately with zero server-side delay.
// Real RTT is measured client-side via performance.now() around the fetch round-trip.
// No geo-formula simulation — the network *is* the measurement.
export const GET: APIRoute = async () => {
  try {
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
