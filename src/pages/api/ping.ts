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
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

export const GET: APIRoute = async ({ request, url }) => {
  const startTime = performance.now();

  try {
    const cbParam = url?.searchParams?.get("cb") || "";
    // Check if this is a packet loss test (bypass rate limiting for controlled rapid tests)
    const isPacketLossTest = cbParam.startsWith("pl-");

    // Rate limiting: 300 requests per minute per IP (skip for packet loss tests)
    const clientIP = getClientIP(request?.headers);
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
          "Retry-After": Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000)).toString(),
        },
      });
    }

    // Return empty body with 204 No Content to minimize transfer time.
    const serverProcessingMs = performance.now() - startTime;
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
        "Server-Timing": `edge;dur=${serverProcessingMs.toFixed(2)}`,
      },
    });
  } catch (globalErr: any) {
    console.error("[Ping Handler Error]", globalErr?.message || globalErr);
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
};

export const POST: APIRoute = GET;
export const HEAD: APIRoute = GET;

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      "Access-Control-Max-Age": "86400",
    },
  });
};
