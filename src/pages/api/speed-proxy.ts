import type { APIRoute } from "astro";

const UPSTREAM = "https://speed.cloudflare.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
};

export const GET: APIRoute = async ({ request }) => {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${UPSTREAM}/__down`);
  upstreamUrl.search = incomingUrl.search;

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { "Accept-Encoding": "identity" },
    });

    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set("Content-Type", upstreamResponse.headers.get("Content-Type") || "application/octet-stream");

    const contentLength = upstreamResponse.headers.get("Content-Length");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    const timingAllowOrigin = upstreamResponse.headers.get("Timing-Allow-Origin");
    if (timingAllowOrigin) {
      responseHeaders.set("Timing-Allow-Origin", timingAllowOrigin);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return new Response(null, {
      status: 502,
      headers: corsHeaders,
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${UPSTREAM}/__up`);
  upstreamUrl.search = incomingUrl.search;

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "POST",
      body: request.body,
    });

    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set("Content-Type", upstreamResponse.headers.get("Content-Type") || "application/octet-stream");

    const contentLength = upstreamResponse.headers.get("Content-Length");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    const timingAllowOrigin = upstreamResponse.headers.get("Timing-Allow-Origin");
    if (timingAllowOrigin) {
      responseHeaders.set("Timing-Allow-Origin", timingAllowOrigin);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return new Response(null, {
      status: 502,
      headers: corsHeaders,
    });
  }
};
