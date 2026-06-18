import type { APIRoute } from "astro";

/**
 * Cloudflare's __down endpoint requires Referer and Origin headers.
 * Without these, Cloudflare treats server-side proxy requests as bot
 * traffic and returns 429. These headers simulate browser-initiated
 * requests that the official @cloudflare/speedtest SDK makes directly
 * from the browser.
 *
 * Reference: https://github.com/cloudflare/speedtest
 */
const CF_SPEED_TEST_ENDPOINT = "https://speed.cloudflare.com/__down";

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 150;

const corsHeaders = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
};

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 3000);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download speed test endpoint.
 * Proxies to Cloudflare's speed test server for real throughput measurement.
 *
 * Follows the official @cloudflare/speedtest protocol:
 * - GET https://speed.cloudflare.com/__down?bytes=N
 * - Requires Referer and Origin headers for Cloudflare to accept the request
 * - Sequential requests (not parallel) to avoid rate limiting
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const sizeParam = url.searchParams.get("size");
    const regionParam = url.searchParams.get("region");
    const serverIdParam = url.searchParams.get("serverId");

    // Default to 10MB if no size is specified; validate bounds
    let size: number;
    if (!sizeParam) {
      size = 10 * 1024 * 1024;
    } else {
      const parsed = parseInt(sizeParam, 10);
      if (Number.isNaN(parsed) || parsed < 1024 || parsed > 25 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: "Invalid size parameter. Must be between 1 KB and 25 MB." }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      size = parsed;
    }

    // Proxy to Cloudflare with retry for transient 429 rate limiting.
    // The Referer/Origin headers below prevent most 429s; retries are
    // only a safety net for legitimate transient overload at the edge.
    // Region and serverId are logged for observability but Cloudflare's
    // speed test endpoint routes to the nearest edge automatically.
    let lastError: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const cfUrl = new URL(CF_SPEED_TEST_ENDPOINT);
        cfUrl.searchParams.set("bytes", String(size));
        if (regionParam) cfUrl.searchParams.set("region", regionParam);
        if (serverIdParam) cfUrl.searchParams.set("serverId", serverIdParam);

        const cfResponse = await fetch(cfUrl.toString(), {
          headers: {
            Referer: "https://speed.cloudflare.com/",
            Origin: "https://speed.cloudflare.com",
            "Cache-Control": "no-store, no-cache",
          },
        });

        if (cfResponse.status === 429) {
          const retryAfter = parseRetryAfter(
            cfResponse.headers.get("Retry-After"),
          );
          const delay =
            retryAfter ?? BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          if (attempt < MAX_RETRIES) {
            await sleep(delay);
            continue;
          }
          throw new Error(
            `Cloudflare responded with status 429 after ${MAX_RETRIES} retries`,
          );
        }

        if (!cfResponse.ok) {
          throw new Error(
            `Cloudflare responded with status ${cfResponse.status}`,
          );
        }

        if (!cfResponse.body) {
          throw new Error("Cloudflare response body is null");
        }

        return new Response(cfResponse.body, {
          status: 200,
          headers: corsHeaders,
        });
      } catch (err: any) {
        lastError = err;
        if (err.message?.includes("429") && attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  } catch (err: any) {
    console.error("Download proxy error:", err?.message || err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || "Download test failed",
      }),
      {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      "Access-Control-Max-Age": "86400",
    },
  });
};
