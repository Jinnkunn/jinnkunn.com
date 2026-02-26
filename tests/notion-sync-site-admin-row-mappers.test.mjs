import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";
import { applySiteSettingsRow } from "../scripts/notion-sync/site-admin-row-mappers.mjs";

function rich(text) {
  return { type: "rich_text", rich_text: [{ plain_text: text }] };
}

function checkbox(value) {
  return { type: "checkbox", checkbox: value };
}

function num(value) {
  return { type: "number", number: value };
}

test("notion-sync-site-admin-row-mappers: applySiteSettingsRow maps sitemap auto exclude fields", () => {
  const cfg = structuredClone(DEFAULT_SITE_CONFIG);
  const row = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    properties: {
      "Sitemap Auto Exclude Enabled": checkbox(false),
      "Sitemap Auto Exclude Sections": rich("blog, teaching"),
      "Sitemap Max Depth Pages": num(2),
      "Sitemap Max Depth Blog": num(3),
      "Sitemap Max Depth Publications": num(4),
      "Sitemap Max Depth Teaching": num(5),
    },
  };

  applySiteSettingsRow(cfg, row);

  assert.deepEqual(cfg.content.sitemapAutoExclude, {
    enabled: false,
    excludeSections: ["blog", "teaching"],
    maxDepthBySection: {
      pages: 2,
      blog: 3,
      publications: 4,
      teaching: 5,
    },
  });
});

test("notion-sync-site-admin-row-mappers: applySiteSettingsRow maps seo page overrides", () => {
  const cfg = structuredClone(DEFAULT_SITE_CONFIG);
  const row = {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    properties: {
      "SEO Page Overrides": rich('{"/blog":{"title":"Blog","noindex":false},"/private":{"noindex":true}}'),
    },
  };

  applySiteSettingsRow(cfg, row);
  assert.deepEqual(cfg.seo.pageOverrides, {
    "/blog": { title: "Blog", noindex: false },
    "/private": { noindex: true },
  });
});
