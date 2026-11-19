/**
 * Centralized Content Security Policy configuration.
 *
 * Add new third-party origins here instead of editing middleware directly.
 * Each key maps to a CSP directive; the value is an array of allowed origins.
 * Production responses enforce this policy. Keep third-party sources limited
 * to integrations observed in the page or recorded Monetag traffic.
 */
const CSP = {
  scriptSrc: [
    "https://challenges.cloudflare.com",
    // Monetag uses WebAssembly compilation; avoid the broader 'unsafe-eval'.
    "'wasm-unsafe-eval'",
    "https://www.googletagmanager.com",
    "https://*.googletagmanager.com",
    "https://static.cloudflareinsights.com",
    "https://pagead2.googlesyndication.com",
    "https://tpc.googlesyndication.com",
    "https://adservice.google.com",
    "https://ep2.adtrafficquality.google",

    // Monetag tags and publisher-observed ad script origins.
    "https://quge5.com",
    "https://al5sm.com",
    "https://auqot.com",
    "https://ekhay.com",
    "https://b3mny.com",
    // Exact inline script hash reported for Monetag zone 12264524.
    "'sha256-qZXLOaBiOd3D4Ypi84lO7EtsJFzqaGjAIHGiXgA/hDM='",

    // Remote script imported by the local Monetag service worker.
    "https://3nbf4.com",
  ],

  styleSrc: [
    "https://fonts.googleapis.com",
    // Monetag inline style hashes reported for zones 12264522 and 12264523.
    "'sha256-tBcS5WremP7Q42MMmtSqUO2uGdBDW2BC2IkwiWS1f3E='",
    "'sha256-9iCWwSuZwwPzbAsH0rJjijUCAdbdMGqO9pBXHcy3dxQ='",
  ],

  styleSrcAttr: [
    "'unsafe-hashes'",
    // Exact Google AdSense style-attribute hash from the CSP report.
    "'sha256-CZH5K2nndphreqYNWZZyQNQjeySnWuXbVHgrqdue+wk='",
  ],

  imgSrc: [
    "https://www.google.co.in",
    "https://pagead2.googlesyndication.com",
    "https://ep1.adtrafficquality.google",
    "https://aichouphaugn.com",
    // Monetag impression pixels observed during strict preview validation.
    "https://jmosl.com",
    "https://094kk.com",
  ],

  connectSrc: [
    "https://challenges.cloudflare.com",
    // Browser-side speed test and observed analytics/ad-quality requests.
    "https://speed.cloudflare.com",
    "https://api-bdc.io",

    // IP geolocation APIs (server-side fallback chain)
    "https://freeipapi.com",
    "https://ipapi.co",
    "https://ipinfo.io",
    "https://api.ipify.org",
    "https://ifconfig.me",
    "https://icanhazip.com",
    "https://ip-api.com",

    // Reverse geocoding
    "https://api.bigdatacloud.net",

    // Google Analytics & Google Tag Manager
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://www.googletagmanager.com",
    "https://www.google.com",
    "https://*.g.doubleclick.net",
    "https://stats.g.doubleclick.net",

    // Google AdSense
    "https://pagead2.googlesyndication.com",
    "https://tpc.googlesyndication.com",
    "https://adservice.google.com",
    "https://csi.gstatic.com",
    "https://ep1.adtrafficquality.google",
    "https://ep2.adtrafficquality.google",

    // HTTPS connection observed for Monetag zone 12274658.
    "https://ay267.com",

    // Monetag connections observed in browser CSP reports.
    "https://my.rtmark.net",
    "https://6opo.com",
    "https://255md.com",
    "https://auqot.com",
    "https://jmosl.com",
    "https://094kk.com",
  ],
  fontSrc: [
    "https://fonts.gstatic.com",
  ],

  frameSrc: [
    "https://challenges.cloudflare.com",
    "https://googleads.g.doubleclick.net",
    "https://pagead2.googlesyndication.com",
    "https://tpc.googlesyndication.com",
    "https://adservice.google.com",
    "https://ep2.adtrafficquality.google",
    "https://www.google.com",
  ],

  workerSrc: [] as string[],
} as const;

type GeneratedCspHashes = {
  script: readonly string[];
  style: readonly string[];
};

export async function extractInlineCspHashes(html: string): Promise<{
  html: string;
  hashes: GeneratedCspHashes;
}> {
  const hashes: { script: string[]; style: string[] } = {
    script: [],
    style: [],
  };

  const strippedHtml = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    const getAttribute = (name: string) => {
      const attribute = tag.match(
        new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
      );
      return attribute?.[1] ?? attribute?.[2] ?? attribute?.[3];
    };

    if (getAttribute("http-equiv")?.toLowerCase() !== "content-security-policy") {
      return tag;
    }

    const content = getAttribute("content");
    if (!content) {
      return "";
    }

    for (const directive of content.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      const destination =
        name === "script-src" || name === "script-src-elem"
          ? hashes.script
          : name === "style-src" || name === "style-src-elem"
            ? hashes.style
            : undefined;

      if (!destination) {
        continue;
      }

      for (const source of sources) {
        if (/^'sha(?:256|384|512)-[A-Za-z0-9+/]+=*'$/i.test(source)) {
          destination.push(source);
        }
      }
    }

    return "";
  });

  const addHash = async (content: string, destination: string[]) => {
    const normalizedContent = content.replace(/\r\n?/g, "\n");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalizedContent),
    );
    const binaryDigest = Array.from(new Uint8Array(digest), (byte) =>
      String.fromCharCode(byte),
    ).join("");
    destination.push(`'sha256-${btoa(binaryDigest)}'`);
  };

  const scripts = [...strippedHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)];
  for (const [, attributes, content] of scripts) {
    if (!/\bsrc\s*=/i.test(attributes)) {
      await addHash(content, hashes.script);
    }
  }

  for (const [, content] of strippedHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    await addHash(content, hashes.style);
  }

  return {
    html: strippedHtml,
    hashes: {
      script: [...new Set(hashes.script)],
      style: [...new Set(hashes.style)],
    },
  };
}

// Build the CSP header string from the config above.
export function buildCspHeader(
  generatedHashes: GeneratedCspHashes = { script: [], style: [] },
): string {
  // Vite HMR uses a blob worker to poll the development server.
  const workerOrigins = [
    ...CSP.workerSrc,
    ...(import.meta.env?.DEV ? ["blob:"] : []),
  ];

  const directives: string[] = [
    `default-src 'self'`,
    `manifest-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
  ];

  const add = (directive: string, origins: readonly string[]) => {
    directives.push(`${directive} 'self' ${origins.join(" ")}`);
  };

  // 'self' is included automatically — do NOT add it manually.
  add("script-src", [...CSP.scriptSrc, ...generatedHashes.script]);
  add("style-src", [...CSP.styleSrc, ...generatedHashes.style]);
  directives.push(`style-src-attr ${CSP.styleSrcAttr.join(" ")}`);
  add("img-src", CSP.imgSrc);
  add("connect-src", CSP.connectSrc);
  add("font-src", CSP.fontSrc);
  add("frame-src", CSP.frameSrc);
  add("worker-src", workerOrigins);

  return directives.join("; ") + ";";
}
