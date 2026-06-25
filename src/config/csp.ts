/**
 * Centralized Content Security Policy configuration.
 *
 * Add new third-party origins here instead of editing middleware directly.
 * Each key maps to a CSP directive; the value is an array of allowed origins.
 * 'self' is included automatically — do NOT add it manually.
 */

const CSP = {
  scriptSrc: [
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://static.cloudflareinsights.com",
  ],

  styleSrc: [
    "'unsafe-inline'",
  ],

  imgSrc: [
    "data:",
    "https:",
  ],

  connectSrc: [
    // Speed test infrastructure (direct browser connection)
    "https://speed.cloudflare.com",

    // IP geolocation APIs
    "https://api.bigdatacloud.net",
    "https://api-bdc.io",
    "https://freeipapi.com",
    "https://ipapi.co",
    "https://ipinfo.io",
    "https://api.ipify.org",
    "https://ifconfig.me",
    "https://icanhazip.com",

    // Google Analytics
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://www.googletagmanager.com",
    "https://www.google.com",

    // WebRTC STUN servers
    // "stun:stun.l.google.com:19302",
    // "stun:stun1.l.google.com:19302",
  ],

  fontSrc: [] as string[],
} as const;

// Build the CSP header string from the config above.
export function buildCspHeader(): string {
  const directives: string[] = [
    "default-src 'self'",
  ];

  const add = (directive: string, origins: readonly string[]) => {
    if (origins.length > 0) {
      directives.push(`${directive} 'self' ${origins.join(' ')}`);
    } else {
      directives.push(`${directive} 'self'`);
    }
  };

  add("script-src", CSP.scriptSrc);
  add("style-src", CSP.styleSrc);
  add("img-src", CSP.imgSrc);
  add("connect-src", CSP.connectSrc);
  add("font-src", CSP.fontSrc);

  return directives.join('; ') + ';';
}
