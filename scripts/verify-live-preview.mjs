async function verifyLivePreview() {
  const baseUrl = 'http://localhost:4322';
  console.log(`Verifying preview server at ${baseUrl}...\n`);

  let allPassed = true;
  function check(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
    } else {
      console.error(`[FAIL] ${message}`);
      allPassed = false;
    }
  }

  // 1. Homepage
  console.log('1. Checking Homepage (/)');
  const res = await fetch(`${baseUrl}/`);
  check(res.status === 200, `Homepage HTTP status is 200 (got ${res.status})`);
  
  const contentType = res.headers.get('content-type') || '';
  console.log(`  Content-Type: ${contentType}`);
  check(contentType.toLowerCase().includes('text/html'), 'Content-Type contains text/html');
  check(contentType.toLowerCase().includes('charset=utf-8'), 'Content-Type explicitly specifies charset=utf-8');

  const xContentTypeOptions = res.headers.get('x-content-type-options');
  check(xContentTypeOptions === 'nosniff', `X-Content-Type-Options is nosniff (got ${xContentTypeOptions})`);

  const csp = res.headers.get('content-security-policy');
  check(!!csp, 'Content-Security-Policy header is present');

  const hsts = res.headers.get('strict-transport-security');
  check(!!hsts, 'Strict-Transport-Security header is present');

  const html = await res.text();

  // Title check
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const rawTitle = titleMatch ? titleMatch[1] : '';
  const title = rawTitle.replace(/&amp;/g, '&');
  console.log(`  Title: "${title}" (raw: "${rawTitle}")`);
  check(title === 'NetSpeed: Free Internet Speed Test & Latency Checker', 'Homepage title matches candidate');

  // Meta description check
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  const desc = descMatch ? descMatch[1] : '';
  console.log(`  Description: "${desc}"`);
  check(desc === "Test your internet download and upload speed, ping, jitter, and bufferbloat with NetSpeed's free online internet speed test.", 'Homepage description matches candidate');

  // Canonical check
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : '';
  console.log(`  Canonical: "${canonical}"`);
  check(canonical === 'https://freenetspeed.com/', 'Homepage canonical URL is https://freenetspeed.com/');

  // Apple touch icon check
  const appleIconMatch = html.match(/<link\s+rel="apple-touch-icon"[^>]*href="([^"]*)"/i);
  console.log(`  Apple Touch Icon link: ${appleIconMatch ? appleIconMatch[0] : 'MISSING'}`);
  check(!!appleIconMatch && appleIconMatch[1] === '/apple-touch-icon.png', 'Apple touch icon link is present pointing to /apple-touch-icon.png');

  // H1 checks
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  console.log(`  H1 count on homepage: ${h1Matches.length}`);
  check(h1Matches.length === 1, `Exactly one H1 element on homepage (got ${h1Matches.length})`);
  if (h1Matches.length > 0) {
    const h1Text = h1Matches[0][1].replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
    console.log(`  H1 text: "${h1Text}" (length: ${h1Text.length} chars)`);
    check(h1Text === 'Free Internet Speed Test & Network Diagnostics', 'H1 text is descriptive and matches candidate');
    check(h1Text.length >= 20, `H1 text length (${h1Text.length} chars) is at least 20 chars`);
  }

  // Check Open Graph & Twitter tags
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  const ogTitle = (ogTitleMatch ? ogTitleMatch[1] : '').replace(/&amp;/g, '&');
  const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
  const ogSiteNameMatch = html.match(/<meta\s+property="og:site_name"\s+content="([^"]*)"/i);
  const twitterCardMatch = html.match(/<meta\s+property="twitter:card"\s+content="([^"]*)"/i);

  check(ogTitle === title, 'og:title matches page title');
  check(ogDescMatch?.[1] === desc, 'og:description matches page description');
  check(ogImageMatch?.[1] === 'https://freenetspeed.com/og-image.png', 'og:image is https://freenetspeed.com/og-image.png');
  check(ogSiteNameMatch?.[1] === 'NetSpeed', 'og:site_name is NetSpeed');
  check(twitterCardMatch?.[1] === 'summary_large_image', 'twitter:card is summary_large_image');

  // Check Schema JSON-LD
  const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  check(!!jsonLdMatch, 'JSON-LD structured data script found');
  if (jsonLdMatch) {
    try {
      const parsedSchema = JSON.parse(jsonLdMatch[1]);
      check(Array.isArray(parsedSchema['@graph']), 'Schema graph array exists');
      const types = parsedSchema['@graph']?.map(item => item['@type']) || [];
      console.log(`  Structured data types in graph: ${types.join(', ')}`);
      check(types.includes('WebSite'), 'Schema includes WebSite');
      check(types.includes('Organization'), 'Schema includes Organization');
      check(types.includes('WebApplication'), 'Schema includes WebApplication');
    } catch (e) {
      check(false, `JSON-LD parsing error: ${e.message}`);
    }
  }

  // Check Apple Touch Icon Asset HTTP 200
  console.log('\n2. Checking Static Assets:');
  const iconRes = await fetch(`${baseUrl}/apple-touch-icon.png`);
  check(iconRes.status === 200, `apple-touch-icon.png returned 200 OK (got ${iconRes.status})`);
  check(iconRes.headers.get('content-type')?.includes('image/png'), 'apple-touch-icon.png returns image/png');

  const precomposedRes = await fetch(`${baseUrl}/apple-touch-icon-precomposed.png`);
  check(precomposedRes.status === 200, `apple-touch-icon-precomposed.png returned 200 OK (got ${precomposedRes.status})`);

  // 3. Check robots.txt
  console.log('\n3. Checking /robots.txt:');
  const robotsRes = await fetch(`${baseUrl}/robots.txt`);
  check(robotsRes.status === 200, `/robots.txt returned 200 OK (got ${robotsRes.status})`);
  const robotsText = await robotsRes.text();
  check(robotsText.includes('Disallow: /api/'), 'robots.txt contains Disallow: /api/');
  check(robotsText.includes('Sitemap: https://freenetspeed.com/sitemap.xml'), 'robots.txt references sitemap.xml');

  // 4. Check sitemap.xml
  console.log('\n4. Checking /sitemap.xml:');
  const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
  check(sitemapRes.status === 200, `/sitemap.xml returned 200 OK (got ${sitemapRes.status})`);
  const sitemapXml = await sitemapRes.text();
  check(sitemapXml.includes('<loc>https://freenetspeed.com/</loc>'), 'sitemap includes homepage with canonical format');
  check(sitemapXml.includes('<loc>https://freenetspeed.com/blog</loc>'), 'sitemap includes /blog');
  check(sitemapXml.includes('<loc>https://freenetspeed.com/faq</loc>'), 'sitemap includes /faq');
  check(!sitemapXml.includes('/api/'), 'sitemap does not include internal /api/ routes');

  console.log(`\nAll checks completed. Overall result: ${allPassed ? 'ALL PASSED!' : 'SOME FAILED!'}`);
  process.exitCode = allPassed ? 0 : 1;
}

verifyLivePreview().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
