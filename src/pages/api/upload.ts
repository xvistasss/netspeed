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
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const region = url.searchParams.get("region");
    const uploadBody = request.body;

    if (!uploadBody) {
      return new Response(
        JSON.stringify({ success: false, error: "No upload body provided" }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Local-edge: just drain the stream (UI testing only, not real throughput)
    if (region === "local-edge") {
      let totalBytes = 0;
      const reader = uploadBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totalBytes += value.length;
        }
      } finally {
        reader.releaseLock();
      }
      return new Response(
        JSON.stringify({ success: true, bytesReceived: totalBytes }),
        { status: 200, headers: corsHeaders },
      );
    }

    // Proxy to Cloudflare with retry for transient 429 rate limiting
    let lastError: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const cfResponse = await fetch(CF_SPEED_TEST_ENDPOINT, {
          method: "POST",
          body: uploadBody,
          // @ts-ignore — duplex is required by Node/Undici for stream bodies
          duplex: "half",
          headers: {
            Referer: "https://speed.cloudflare.com/",
            Origin: "https://speed.cloudflare.com",
            "Cache-Control": "no-store, no-cache",
            "Content-Type": "application/octet-stream",
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

        // Read response to ensure completion
        await cfResponse.text();

        const bytesReceived = parseInt(
          request.headers.get("content-length") || "0",
          10,
        );

        return new Response(
          JSON.stringify({ success: true, bytesReceived }),
          { status: 200, headers: corsHeaders },
        );
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
      { status: 502, headers: corsHeaders },
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
