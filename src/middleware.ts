import { defineMiddleware } from 'astro:middleware';
import { buildCspHeader } from './config/csp';

// Anti-cache headers applied to ALL responses.
// "no-store" prevents browser/CDN from writing to disk cache.
// "no-cache" + "must-revalidate" force revalidation on every request.
// "s-maxage=0" tells Cloudflare edge and shared caches to never serve stale.
const ANTI_CACHE = 'no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0';

const cspHeader = buildCspHeader();

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const pathname = context.url.pathname;
  const isApiEndpoint = pathname.startsWith('/api/');

  // Every response gets anti-cache headers — pages AND API endpoints.
  // This prevents Chrome from serving stale HTML from disk cache on reload,
  // and prevents any intermediate proxy from caching API responses.
  response.headers.set('Cache-Control', ANTI_CACHE);
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  // Security headers for all responses
  response.headers.set('X-Content-Type-Options', 'nosniff');

  if (!isApiEndpoint) {
    // Additional security headers for page responses only
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=()');
    response.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
    response.headers.set('Content-Security-Policy', cspHeader);
  }

  return response;
});
