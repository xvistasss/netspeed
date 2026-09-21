import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async ({ site }) => {
  const origin = site ? new URL(site).origin : "https://freenetspeed.com";
  const defaultLastmod = new Date().toISOString().split("T")[0];

  const staticPages = [
    { loc: "", priority: "1.0", changefreq: "daily" },
    { loc: "/how-it-works", priority: "0.9", changefreq: "weekly" },
    { loc: "/blog", priority: "0.9", changefreq: "daily" },
    { loc: "/faq", priority: "0.8", changefreq: "weekly" },
    { loc: "/about", priority: "0.8", changefreq: "monthly" },
    { loc: "/contact", priority: "0.7", changefreq: "monthly" },
    { loc: "/privacy", priority: "0.5", changefreq: "monthly" },
    { loc: "/terms", priority: "0.5", changefreq: "monthly" },
  ];

  let blogPages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [];
  try {
    const posts = await getCollection("blog");
    blogPages = posts.map((post) => {
      const rawDate = post?.data?.updatedDate || post?.data?.pubDate;
      const validDate = rawDate instanceof Date && !isNaN(rawDate.getTime()) ? rawDate : new Date();
      return {
        loc: `/blog/${post.id}`,
        priority: "0.8",
        changefreq: "monthly",
        lastmod: validDate.toISOString().split("T")[0],
      };
    });
  } catch (err) {
    console.error("[Sitemap Generation Error]", err);
  }

  const allPages = [
    ...staticPages.map((p) => ({ ...p, lastmod: defaultLastmod })),
    ...blogPages,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${allPages.map((page) => `
      <url>
        <loc>${origin}${page.loc}</loc>
        <lastmod>${page.lastmod}</lastmod>
        <changefreq>${page.changefreq}</changefreq>
        <priority>${page.priority}</priority>
      </url>`,
  ).join("\n")}
  </urlset>`.trim();

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
};
