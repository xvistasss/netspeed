import type { APIRoute } from "astro";

const CF_SPEED_TEST_ENDPOINT = "https://speed.cloudflare.com/__up";

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 150;

const corsHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
 * Upload speed test endpoint.
 * Proxies to Cloudflare's speed test server for real throughput measurement.
 *
 * Follows the official @cloudflare/speedtest protocol:
 * - POST https://speed.cloudflare.com/__up
 * - Requires Referer and Origin headers for Cloudflare to accept the request
 *
 * Forwards the raw request body stream directly to Cloudflare without buffering.
 * The client measures upload speed as time from request start to response headers
 * arriving — the same method fast.com and speed.cloudflare.com use.
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const uploadBody = request.body;

    if (!uploadBody) {
      return new Response(
        JSON.stringify({ success: false, error: "No upload body provided" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const regionParam = url.searchParams.get("region");
    const serverIdParam = url.searchParams.get("serverId");

    const cfUrl = new URL(CF_SPEED_TEST_ENDPOINT);
    if (regionParam) cfUrl.searchParams.set("region", regionParam);
    if (serverIdParam) cfUrl.searchParams.set("serverId", serverIdParam);

    let lastError: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        let bodyToSend: ReadableStream;
        if (attempt === 0) {
          bodyToSend = uploadBody;
        } else {
          const [retryCount, retryProxy] = uploadBody.tee();
          void retryCount.cancel();
          bodyToSend = retryProxy;
        }

        const upstreamController = new AbortController();
        const upstreamTimeout = setTimeout(() => upstreamController.abort(), 25000);

        let cfResponse: Response;
        try {
          cfResponse = await fetch(cfUrl.toString(), {
            method: "POST",
            body: bodyToSend,
            headers: {
              Referer: "https://speed.cloudflare.com/",
              Origin: "https://speed.cloudflare.com",
              "Cache-Control": "no-store, no-cache",
              "Content-Type": "application/octet-stream",
            },
            signal: upstreamController.signal,
          });
        } finally {
          clearTimeout(upstreamTimeout);
        }

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
    console.error("Upload proxy error:", err?.message || err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || "Upload test failed",
      }),
      {
        status: 502,
        headers: corsHeaders,
      },
    );
  }
};

export const GET: APIRoute = async () => {
  return new Response("Use POST to test upload speeds", {
    status: 405,
    headers: corsHeaders,
  });
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      "Access-Control-Max-Age": "86400",
    },
  });
};
