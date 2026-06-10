import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;

  const robots = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`.trim();

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400'
    }
  });
};
