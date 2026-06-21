import type { APIRoute } from "astro";
import { checkRateLimit, getClientIP, createRateLimitHeaders } from "../../utils/rateLimiter";

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
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// The ping endpoint returns "pong" immediately with zero server-side delay.
// Real RTT is measured client-side via performance.now() around the fetch round-trip.
//
// NOTE: This measures HTTP-level RTT (TCP + TLS + HTTP framing), not ICMP RTT.
// On a typical connection this adds ~1-3ms overhead vs native ICMP ping.
// The browser's HTTP/2 connection pooling eliminates repeated TCP/TLS handshakes
// after the first request, so subsequent pings measure near-wire latency.
//
// For true ICMP measurement, a native client (e.g., the CLI script) is required.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    // Check if this is a packet loss test (bypass rate limiting for controlled tests)
    const isPacketLossTest = url.searchParams.get("cb")?.startsWith("pl-");
    
    // Rate limiting: 200 requests per minute per IP (skip for packet loss tests)
    const clientIP = getClientIP(request.headers);
    const rateLimit = isPacketLossTest 
      ? { allowed: true, remaining: 999, resetTime: Date.now() + 60000 }
      : checkRateLimit(clientIP, { maxRequests: 200, windowMs: 60000 });
    
    if (!rateLimit.allowed) {
      return new Response("Rate limit exceeded", {
        status: 429,
        headers: {
          ...corsHeaders,
          ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
          "Retry-After": Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
        },
      });
    }

    // Return a minimal body to avoid response buffering delays.
    // The "pong" body is ~5 bytes — negligible transfer time.
    return new Response("pong", {
      status: 200,
      headers: {
        ...corsHeaders,
        ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
      },
    });
  } catch (globalErr: any) {
    console.error("Global ping handler error:", globalErr);
    return new Response(globalErr?.message || "Internal server error during ping", {
      status: 500,
      headers: corsHeaders,
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
