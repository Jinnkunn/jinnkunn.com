/* Sync raw blog post pages from the live site into `content/raw/`.
 *
 * This keeps the clone self-contained while still using the original HTML.
 *
 * Usage:
 *   node scripts/sync-raw-blog.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://jinkunchen.com";

function uniq(arr) {
  return Array.from(new Set(arr));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "jinnkunn.com raw sync (local dev)",
      accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText}: ${url}`);
  }
  return await res.text();
}

function extractBlogListLinks(blogHtml) {
  const matches = Array.from(
    blogHtml.matchAll(/href\s*=\s*"(\/blog\/list\/[^"]+)"/g)
  ).map((m) => m[1]);
  return uniq(matches);
}

function hasMainTag(html) {
  return /<main\b[\s\S]*?<\/main>/i.test(html);
}

async function syncBlogPosts() {
  const blogRawPath = path.join(ROOT, "content", "raw", "blog.html");
  const blogHtml = fs.readFileSync(blogRawPath, "utf8");

  const links = extractBlogListLinks(blogHtml);
  if (links.length === 0) {
    console.error("No /blog/list links found in content/raw/blog.html");
    process.exitCode = 1;
    return;
  }

  console.log(`Found ${links.length} blog posts.`);

  for (const p of links) {
    const url = `${SITE_ORIGIN}${p}`;
    console.log(`Fetching ${url}`);
    const html = await fetchText(url);
    if (!hasMainTag(html)) {
      throw new Error(`No <main> found in fetched HTML: ${url}`);
    }

    const outFile = path.join(ROOT, "content", "raw", `${p.replace(/^\//, "")}.html`);
    writeFile(outFile, html);
  }
}

async function syncRssAndAtom() {
  const rssUrl = `${SITE_ORIGIN}/blog.rss`;
  const atomUrl = `${SITE_ORIGIN}/blog.atom`;

  console.log(`Fetching ${rssUrl}`);
  const rss = await fetchText(rssUrl);
  writeFile(path.join(ROOT, "public", "blog.rss"), rss);

  console.log(`Fetching ${atomUrl}`);
  const atom = await fetchText(atomUrl);
  writeFile(path.join(ROOT, "public", "blog.atom"), atom);
}

await syncBlogPosts();
await syncRssAndAtom();

console.log("Done.");

