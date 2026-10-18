import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== NetSpeed SEO Audit & Verification ===\n');

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedTests++;
  }
}

// 1. Asset Checks
console.log('1. Checking Public Assets & Icons:');
const appleTouchIconPath = path.join(rootDir, 'public', 'apple-touch-icon.png');
assert(fs.existsSync(appleTouchIconPath), 'public/apple-touch-icon.png exists');

const precomposedIconPath = path.join(rootDir, 'public', 'apple-touch-icon-precomposed.png');
assert(fs.existsSync(precomposedIconPath), 'public/apple-touch-icon-precomposed.png exists');

const faviconPath = path.join(rootDir, 'public', 'favicon.svg');
assert(fs.existsSync(faviconPath), 'public/favicon.svg exists');

const ogImagePath = path.join(rootDir, 'public', 'og-image.png');
assert(fs.existsSync(ogImagePath), 'public/og-image.png exists');

const webmanifestPath = path.join(rootDir, 'public', 'site.webmanifest');
const manifestContent = JSON.parse(fs.readFileSync(webmanifestPath, 'utf8'));
const hasAppleIconInManifest = manifestContent.icons?.some(i => i.src === '/apple-touch-icon.png' && i.sizes === '180x180');
assert(hasAppleIconInManifest, 'site.webmanifest includes apple-touch-icon.png 180x180');

// 2. Pixel width and character length checks
console.log('\n2. Homepage Title & Description Quality:');
const expectedTitle = 'NetSpeed: Free Internet Speed Test & Latency Checker';
const expectedDescription = "Test your internet download and upload speed, ping, jitter, and bufferbloat with NetSpeed's free online internet speed test.";

// Proportional pixel width estimator for standard Arial/system-ui at 18px (Title) and 14px (Snippet)
function estimatePixelWidth(text, fontSize) {
  // Average width multiplier relative to font size for sans-serif
  const charWidthTable = {
    'i': 0.28, 'l': 0.28, 'j': 0.28, 'f': 0.33, 't': 0.33, 'r': 0.33,
    'm': 0.88, 'w': 0.88, 'M': 0.88, 'W': 0.95,
    ' ': 0.28, ':': 0.28, '.': 0.28, ',': 0.28, '-': 0.33, '&': 0.65
  };
  let width = 0;
  for (const char of text) {
    const factor = charWidthTable[char] ?? (char >= 'A' && char <= 'Z' ? 0.68 : 0.54);
    width += factor * fontSize;
  }
  return Math.round(width);
}

const titleWidth = estimatePixelWidth(expectedTitle, 18);
const descWidth = estimatePixelWidth(expectedDescription, 14);

console.log(`  Title: "${expectedTitle}"`);
console.log(`  Title Length: ${expectedTitle.length} characters, Estimated Pixel Width: ${titleWidth}px (Max: 580px)`);
assert(expectedTitle.length >= 20 && expectedTitle.length <= 60, 'Title character length is between 20 and 60');
assert(titleWidth <= 580, `Title pixel width (${titleWidth}px) is within Google SERP 580px limit`);

console.log(`  Description: "${expectedDescription}"`);
console.log(`  Description Length: ${expectedDescription.length} characters, Estimated Pixel Width: ${descWidth}px (Max: 1000px)`);
assert(expectedDescription.length >= 70 && expectedDescription.length <= 155, 'Description character length is between 70 and 155');
assert(descWidth <= 1000, `Description pixel width (${descWidth}px) is well within SEObility 1000px limit`);

// 3. Source Code Integrity Checks
console.log('\n3. Source Code Integrity:');

// Check Layout.astro
const layoutContent = fs.readFileSync(path.join(rootDir, 'src', 'layouts', 'Layout.astro'), 'utf8');
assert(layoutContent.includes('rel="apple-touch-icon"'), 'Layout.astro includes apple-touch-icon link');
assert(layoutContent.includes('rel="canonical"'), 'Layout.astro includes canonical URL link');
assert(layoutContent.includes('og:site_name'), 'Layout.astro includes og:site_name tag');
assert(layoutContent.includes('@type": "WebSite"'), 'Layout.astro includes WebSite schema');
assert(layoutContent.includes('@type": "Organization"'), 'Layout.astro includes Organization schema');
assert(layoutContent.includes('@type": "WebApplication"'), 'Layout.astro includes WebApplication schema');
assert(layoutContent.includes('@type": "BreadcrumbList"'), 'Layout.astro generates BreadcrumbList schema for subpages');

// Check SpeedTest.tsx
const speedTestContent = fs.readFileSync(path.join(rootDir, 'src', 'speed-test', 'components', 'SpeedTest.tsx'), 'utf8');
const h1Matches = speedTestContent.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
assert(h1Matches !== null, 'SpeedTest.tsx contains an H1 heading');
if (h1Matches) {
  const h1Text = h1Matches[1].replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
  console.log(`  Homepage H1 Text: "${h1Text}" (Length: ${h1Text.length} chars)`);
  assert(h1Text.length >= 20, `H1 text length (${h1Text.length} chars) exceeds 20 characters as required by SEObility`);
  assert(h1Text.includes('Free Internet Speed Test'), 'H1 includes primary search keyword');
}

// Ensure redundant subnav was removed from SpeedTest.tsx
const hasRedundantSubnav = speedTestContent.includes('href="/about"') && speedTestContent.includes('href="/privacy"');
assert(!hasRedundantSubnav, 'Redundant inline subnav removed from SpeedTest.tsx hero');

// Check index.astro
const indexContent = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'index.astro'), 'utf8');
assert(indexContent.includes('title="NetSpeed: Free Internet Speed Test & Latency Checker"'), 'index.astro explicitly passes optimal homepage title');
assert(indexContent.includes('description="Test your internet download and upload speed'), 'index.astro explicitly passes optimal homepage description');

// Check blog card link anchor separation
const cardAnchorMatch = indexContent.includes('<article') && indexContent.includes('class="focus:outline-hidden after:absolute after:inset-0"');
assert(cardAnchorMatch, 'index.astro decouples title link anchor from dates and description excerpts');

// Check middleware.ts
const middlewareContent = fs.readFileSync(path.join(rootDir, 'src', 'middleware.ts'), 'utf8');
assert(middlewareContent.includes('charset=utf-8'), 'middleware.ts ensures HTML responses declare charset=utf-8');

// Check robots.txt and sitemap.xml
const robotsContent = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'robots.txt.ts'), 'utf8');
assert(robotsContent.includes('Disallow: /api/'), 'robots.txt.ts protects /api/ routes');
assert(robotsContent.includes('Sitemap:'), 'robots.txt.ts references sitemap.xml');

const sitemapContent = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'sitemap.xml.ts'), 'utf8');
assert(sitemapContent.includes('staticPages'), 'sitemap.xml.ts includes static published pages');
assert(sitemapContent.includes('blogPages'), 'sitemap.xml.ts includes blog guide pages');

console.log(`\n=== Summary: ${passedTests} passed, ${failedTests} failed ===\n`);
if (failedTests > 0) {
  process.exit(1);
}
