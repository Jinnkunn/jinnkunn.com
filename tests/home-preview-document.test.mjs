import test from "node:test";
import assert from "node:assert/strict";

import { buildHomePreviewDocument } from "../apps/workspace/src/surfaces/site-admin/home-builder/preview-document.ts";

test("home preview document prefers route CSS assets from the public build", () => {
  const html = buildHomePreviewDocument(
    '<main id="main-content">Preview</main>',
    "https://staging.jinkunchen.com",
    ["/_next/static/css/classic.css", "/_next/static/css/home.css"],
  );

  assert.match(html, /href="\/_next\/static\/css\/classic\.css"/);
  assert.match(html, /href="\/_next\/static\/css\/home\.css"/);
  assert.doesNotMatch(html, /href="\/styles\/super\.css"/);
  assert.match(html, /<base href="https:\/\/staging\.jinkunchen\.com\/" \/>/);
});

test("home preview document falls back to public Super styles without build assets", () => {
  const html = buildHomePreviewDocument(
    '<main id="main-content">Preview</main>',
    "https://staging.jinkunchen.com",
    [],
  );

  const superInline = html.indexOf('href="/styles/super-inline.css"');
  const staticCss = html.indexOf('href="/styles/static.css"');
  const notionCss = html.indexOf('href="/styles/notion.css"');
  const superCss = html.indexOf('href="/styles/super.css"');
  const navCss = html.indexOf('href="/styles/super-nav.css"');

  assert.ok(superInline > 0);
  assert.ok(superInline < staticCss);
  assert.ok(staticCss < notionCss);
  assert.ok(notionCss < superCss);
  assert.ok(superCss < navCss);
});
