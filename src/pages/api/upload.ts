import type { APIRoute } from "astro";

const CF_SPEED_TEST_ENDPOINT = "https://speed.cloudflare.com/__up";

const corsHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, no-transform, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Content-Encoding": "identity",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Timing-Allow-Origin": "*",
};

/**
 * Upload speed test endpoint.
 * Proxies to Cloudflare's speed test server for real throughput measurement.
 * The region param is used for latency simulation in the ping endpoint, not here.
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

    // Proxy to Cloudflare for real network throughput measurement
    const cfResponse = await fetch(CF_SPEED_TEST_ENDPOINT, {
      method: "POST",
      body: uploadBody,
      // @ts-ignore — duplex is required by Node/Undici for stream bodies
      duplex: "half",
      headers: {
        "Cache-Control": "no-store, no-cache",
        "Content-Type": "application/octet-stream",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!cfResponse.ok) {
      throw new Error(`Cloudflare responded with status ${cfResponse.status}`);
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
