// Rate limiter for API endpoints
// NOTE: In Cloudflare Workers, in-memory state is per-isolate and NOT shared
// across requests. This rate limiter uses a best-effort approach with generous
// limits to avoid false positives. For strict rate limiting, use Cloudflare's
// built-in rate limiting or Durable Objects.

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

/**
 * Perform lazy cleanup of expired rate limit entries without persistent setInterval timers
 * (compliant with Cloudflare Workers / workerd runtime constraints).
 */
function cleanupExpiredEntries(now: number) {
  if (now - lastCleanup < 60000 && rateLimitStore.size < 500) {
    return;
  }
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param identifier - Unique identifier (e.g., IP address)
 * @param config - Rate limit configuration
 * @returns { allowed: boolean, remaining: number, resetTime: number }
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimiterConfig = { maxRequests: 100, windowMs: 60000 }
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const safeId = identifier || "unknown";
  const entry = rateLimitStore.get(safeId);

  if (!entry || now > entry.resetTime) {
    // New window or expired window
    rateLimitStore.set(safeId, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, config.maxRequests - 1),
      resetTime: now + config.windowMs,
    };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}

/**
 * Create a rate limit response with appropriate headers.
 * Returns a Response object ready to send to the client.
 */
export function createRateLimitResponse(
  rateLimit: { allowed: boolean; remaining: number; resetTime: number },
  corsHeaders: Record<string, string>
): Response | null {
  if (rateLimit.allowed) return null;

  const retryAfter = Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000));
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: {
      ...corsHeaders,
      ...Object.fromEntries(createRateLimitHeaders(rateLimit.remaining, rateLimit.resetTime)),
      "Retry-After": retryAfter.toString(),
    },
  });
}

/**
 * Get client IP from request headers safely
 * @param headers - Request headers
 * @returns Client IP address
 */
export function getClientIP(headers?: Headers | null): string {
  if (!headers || typeof headers.get !== "function") {
    return "127.0.0.1";
  }

  try {
    // Check for forwarded headers first (for proxies)
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }

    // Check for real IP header
    const realIP = headers.get("x-real-ip");
    if (realIP) {
      return realIP.trim();
    }

    // Fallback to CF-Connecting-IP (Cloudflare)
    const cfIP = headers.get("cf-connecting-ip");
    if (cfIP) {
      return cfIP.trim();
    }

    const vercelIP = headers.get("x-vercel-forwarded-for");
    if (vercelIP) {
      return vercelIP.split(",")[0]?.trim() || vercelIP.trim();
    }
  } catch {
    // Fallback in case header parsing fails
  }

  return "127.0.0.1";
}

/**
 * Create rate limit response headers
 * @param remaining - Remaining requests in window
 * @param resetTime - Window reset time in milliseconds
 * @returns Headers object
 */
export function createRateLimitHeaders(
  remaining: number,
  resetTime: number
): Headers {
  const headers = new Headers();
  headers.set("X-RateLimit-Remaining", Math.max(0, remaining).toString());
  headers.set("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return headers;
}