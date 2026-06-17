import type { APIRoute } from "astro";

const CF_SPEED_TEST_ENDPOINT = "https://speed.cloudflare.com/__down";

const corsHeaders = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
};

/**
 * Download speed test endpoint.
 * Proxies to Cloudflare's speed test server for real throughput measurement.
 * The region param is used for latency simulation in the ping endpoint, not here.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const sizeParam = url.searchParams.get("size");
    const region = url.searchParams.get("region");

    // Default to 10MB if no size is specified
    const size = sizeParam ? parseInt(sizeParam, 10) : 10 * 1024 * 1024;

    // Local-edge: generate data locally (UI testing only, not real throughput)
    if (region === "local-edge") {
      return new Response(createLocalGeneratorStream(size), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Proxy to Cloudflare for real network throughput measurement
    const cfResponse = await fetch(
      `${CF_SPEED_TEST_ENDPOINT}?bytes=${size}`,
      {
        headers: {
          "Cache-Control": "no-store, no-cache",
          Pragma: "no-cache",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    );

    if (!cfResponse.ok) {
      throw new Error(`Cloudflare responded with status ${cfResponse.status}`);
    }

    if (!cfResponse.body) {
      throw new Error("Cloudflare response body is null");
    }

    return new Response(cfResponse.body, {
      status: 200,
      headers: corsHeaders,
    });
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

/**
 * Local data generator — only used for local-edge UI testing.
 * NOT a real throughput measurement.
 */
function createLocalGeneratorStream(size: number): ReadableStream<Uint8Array> {
  const bufferSize = 4 * 1024 * 1024; // 4MB buffer
  const preGeneratedBuffer = new Uint8Array(bufferSize);
  for (let i = 0; i < bufferSize; i++) {
    preGeneratedBuffer[i] = Math.floor(Math.random() * 256);
  }

  const chunkSize = 256 * 1024; // 256KB chunks
  let bytesSent = 0;

  return new ReadableStream({
    pull(controller) {
      if (bytesSent >= size) {
        controller.close();
        return;
      }
      const remaining = size - bytesSent;
      const currentChunkSize = Math.min(chunkSize, remaining);

      const maxOffset = bufferSize - currentChunkSize;
      const randomOffset = Math.floor(Math.random() * maxOffset);
      controller.enqueue(
        preGeneratedBuffer.slice(randomOffset, randomOffset + currentChunkSize),
      );
      bytesSent += currentChunkSize;
    },
  });
}

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
