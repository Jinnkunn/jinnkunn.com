import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { registerNextModuleHooks } from "../helpers/next-module-hooks.mjs";

const REPO_ROOT = registerNextModuleHooks();

// The Worker bundle contains `content/**/*.json` and nothing else — no MDX, no
// `content/` directory next to `process.cwd()` at all. Running the real sitemap
// builders from an empty cwd reproduces that exactly: anything that still reads
// MDX off disk collapses to the handful of hard-coded routes, which is how
// production ended up with a 4-URL sitemap.
const EMPTY_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-worker-cwd-"));
const originalCwd = process.cwd();
process.chdir(EMPTY_CWD);

process.on("exit", () => {
  process.chdir(originalCwd);
  fs.rmSync(EMPTY_CWD, { recursive: true, force: true });
});

const sitemapRoutes = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/server/sitemap-routes.ts")).href
);
const sitemapXml = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/server/sitemap-xml.ts")).href
);

const contentRoutes = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "content", "generated", "content-routes.json"), "utf8"),
);
const publishedRoutes = contentRoutes.filter((row) => !row.draft);
const draftRoutes = contentRoutes.filter((row) => row.draft);

test("sitemap: every published post and page is present without filesystem MDX", () => {
  const urls = sitemapRoutes.getSitemapUrls();
  const paths = new Set(urls.map((u) => u.routePath));

  const posts = publishedRoutes.filter((row) => row.kind === "post");
  assert.ok(posts.length >= 8, `expected at least 8 published posts, got ${posts.length}`);
  for (const row of posts) {
    assert.ok(paths.has(row.routePath), `sitemap is missing ${row.routePath}`);
  }

  // The routes production was serving 200s for while the sitemap listed none of them.
  for (const routePath of ["/bio", "/publications", "/teaching", "/works", "/news", "/now", "/connect"]) {
    assert.ok(paths.has(routePath), `sitemap is missing ${routePath}`);
  }

  for (const row of draftRoutes) {
    assert.equal(paths.has(row.routePath), false, `draft leaked into sitemap: ${row.routePath}`);
  }
});

test("sitemap: every section builder returns a non-empty urlset", () => {
  for (const section of sitemapRoutes.SITEMAP_SECTION_ORDER) {
    const urls = sitemapRoutes.getSitemapSectionUrls(section);
    assert.ok(urls.length > 0, `sitemap section ${section} is empty`);
  }
});

test("sitemap: section docs carry a lastmod for each section", () => {
  for (const doc of sitemapRoutes.getSitemapSectionDocs()) {
    assert.ok(doc.urls.length > 0, `section ${doc.section} has no urls`);
    assert.ok(doc.lastmod, `section ${doc.section} has no lastmod`);
    assert.ok(Number.isFinite(Date.parse(doc.lastmod)));
  }
});

test("sitemap: lastmod tracks frontmatter dates from the generated index", () => {
  const urls = new Map(sitemapRoutes.getSitemapUrls().map((u) => [u.routePath, u]));
  let checked = 0;
  for (const row of publishedRoutes) {
    // Protected / excluded routes legitimately never reach the sitemap.
    const url = urls.get(row.routePath);
    if (!row.lastmod || !url) continue;
    assert.ok(url.lastmod, `missing lastmod for ${row.routePath}`);
    assert.equal(
      url.lastmod.slice(0, 10),
      row.lastmod.slice(0, 10),
      `lastmod mismatch for ${row.routePath}`,
    );
    checked += 1;
  }
  assert.ok(checked >= 15, `expected to verify many lastmods, only checked ${checked}`);
});

test("sitemap xml: urlset renders <lastmod> when present and omits it when not", () => {
  const xml = sitemapXml.renderSitemapUrlsetXml("https://example.com", [
    { routePath: "/blog/a", lastmod: "2026-02-07T00:00:00.000Z" },
    { routePath: "/b", lastmod: null },
  ]);

  assert.match(
    xml,
    /<url>\s*<loc>https:\/\/example\.com\/blog\/a<\/loc>\s*<lastmod>2026-02-07T00:00:00\.000Z<\/lastmod>\s*<\/url>/,
  );
  assert.match(xml, /<url>\s*<loc>https:\/\/example\.com\/b<\/loc>\s*<\/url>/);
});

test("sitemap xml: real blog section renders one <lastmod> per url", () => {
  const urls = sitemapRoutes.getSitemapSectionUrls("blog");
  const xml = sitemapXml.renderSitemapUrlsetXml("https://example.com", urls);
  const locs = xml.match(/<loc>/g) || [];
  const lastmods = xml.match(/<lastmod>/g) || [];

  assert.equal(locs.length, urls.length);
  assert.equal(lastmods.length, urls.filter((u) => u.lastmod).length);
  assert.ok(lastmods.length > 0);
});

test("sitemap xml: index renders <lastmod> for section docs", () => {
  const docs = sitemapRoutes.getSitemapSectionDocs();
  const xml = sitemapXml.renderSitemapIndexXml(
    "https://example.com",
    docs.map((doc) => ({ path: doc.path, lastmod: doc.lastmod })),
  );

  assert.equal((xml.match(/<sitemap>/g) || []).length, docs.length);
  assert.equal((xml.match(/<lastmod>/g) || []).length, docs.length);
});
