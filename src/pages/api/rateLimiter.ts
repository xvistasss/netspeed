// Rate limiter for API endpoints
// NOTE: In Cloudflare Workers, in-memory state is per-isolate and NOT shared
// across requests. This rate limiter uses a best-effort approach with generous
// limits to avoid false positives. For strict rate limiting, use Cloudflare's
// built-in rate limiting or Durable Objects.
//
// Strategy: Use generous limits that work across Worker instances.
// The rate limiter is mainly a safety net against abuse, not a strict limiter.

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
// NOTE: This only cleans the current isolate's memory. Other isolates
// will have their own cleanup cycles.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * IMPORTANT: In Cloudflare Workers, this is per-isolate, not global.
 * Each Worker isolate has its own rateLimitStore. This means:
 * - A user hitting different isolates may get separate rate limit buckets
 * - The rate limit is best-effort, not strict
 * - For strict limits, use Cloudflare's built-in rate limiting rules
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
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetTime) {
    // New window or expired window
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
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
    remaining: config.maxRequests - entry.count,
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

  const retryAfter = Math.ceil((rateLimit.resetTime - Date.now()) / 1000);
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
 * Get client IP from request headers
 * @param headers - Request headers
 * @returns Client IP address
 */
export function getClientIP(headers: Headers): string {
  // Check for forwarded headers first (for proxies)
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the list
    return forwarded.split(",")[0].trim();
  }

  // Check for real IP header
  const realIP = headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  // Fallback to CF-Connecting-IP (Cloudflare)
  const cfIP = headers.get("cf-connecting-ip");
  if (cfIP) {
    return cfIP;
  }

  // Default fallback
  return "unknown";
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
  headers.set("X-RateLimit-Remaining", remaining.toString());
  headers.set("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return headers;
}