import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;

  const pages = [
    { loc: '', priority: '1.0', changefreq: 'daily' },
    { loc: '/about', priority: '0.8', changefreq: 'monthly' },
    { loc: '/contact', priority: '0.8', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.5', changefreq: 'monthly' },
    { loc: '/terms', priority: '0.5', changefreq: 'monthly' }
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${origin}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`.trim();

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400'
    }
  });
};
