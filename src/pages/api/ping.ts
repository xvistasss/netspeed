import type { APIRoute } from "astro";
import { checkRateLimit, getClientIP, createRateLimitHeaders } from "./rateLimiter";

// Optimized CORS headers for ping endpoint.
// Minimal headers to reduce response size and latency.
// NOTE: Content-Type is omitted for 204 responses (RFC 7230 Section 3.1.1.5)
const corsHeaders: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

// The ping endpoint returns an empty body immediately with zero server-side delay.
// Real RTT is measured client-side via performance.now() around the fetch round-trip.
//
// OPTIMIZATION: Empty body (0 bytes) instead of "pong" (5 bytes).
// While 5 bytes seems negligible, at 100+ pings per test, this saves:
// - 500+ bytes of transfer
// - Potential buffering delays on slow connections
// - HTTP framing overhead per chunk
//
// OPTIMIZATION: 204 No Content status instead of 200 OK.
// 204 responses are explicitly defined to have no body, so:
// - Browsers skip body parsing entirely
// - No Content-Type header needed (RFC 7230)
// - Reduces response overhead by ~10-20 bytes per ping
//
// NOTE: This measures HTTP-level RTT (TCP + TLS + HTTP framing), not ICMP RTT.
// On a typical connection this adds ~1-3ms overhead vs native ICMP ping.
// The browser's HTTP/2 connection pooling eliminates repeated TCP/TLS handshakes
// after the first request, so subsequent pings measure near-wire latency.
//
// For true ICMP measurement, a native client (e.g., the CLI script) is required.
export const GET: APIRoute = async ({ request, url }) => {
  const startTime = performance.now();

  try {
    // Check if this is a packet loss test (bypass rate limiting for controlled tests)
    const isPacketLossTest = url.searchParams.get("cb")?.startsWith("pl-");

    // Rate limiting: 300 requests per minute per IP (skip for packet loss tests)
    // NOTE: In Cloudflare Workers, this is per-isolate, not global.
    // The limit is generous to avoid false positives across Worker instances.
    const clientIP = getClientIP(request.headers);
    const rateLimit = isPacketLossTest
      ? { allowed: true, remaining: 999, resetTime: Date.now() + 60000 }
      : checkRateLimit(clientIP, { maxRequests: 300, windowMs: 60000 });

    if (!rateLimit.allowed) {
      return new Response("Rate limit exceeded", {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
          "Retry-After": Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
        },
      });
    }

    // Return empty body with 204 No Content to minimize transfer time.
    // The client measures RTT via performance.now() around the fetch call.
    const serverProcessingMs = performance.now() - startTime;
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
        // Server-Timing header for debugging (visible in DevTools Network tab)
        "Server-Timing": `edge;dur=${serverProcessingMs.toFixed(2)}`,
      },
    });
  } catch (globalErr: any) {
    console.error("Global ping handler error:", globalErr);
    return new Response(globalErr?.message || "Internal server error during ping", {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
};

export const POST: APIRoute = GET;

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
