import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.ts";
import { groupLabelForRoutePath, sortGroupLabels } from "../lib/shared/search-group.ts";
import { scoreSearchResult } from "../lib/search/rank.ts";

test("shared-ts-facades: default site config exposes expected required keys", () => {
  assert.equal(typeof DEFAULT_SITE_CONFIG.siteName, "string");
  assert.equal(typeof DEFAULT_SITE_CONFIG.lang, "string");
  assert.equal(Array.isArray(DEFAULT_SITE_CONFIG.nav.top), true);
  assert.equal(Array.isArray(DEFAULT_SITE_CONFIG.nav.more), true);
});

test("shared-ts-facades: search group labels match route shape", () => {
  assert.equal(groupLabelForRoutePath("/"), "Home");
  assert.equal(groupLabelForRoutePath("/blog/post-a"), "Blog");
  assert.equal(groupLabelForRoutePath("/teaching/archive"), "Teaching");
  assert.deepEqual(sortGroupLabels(["Works", "Blog", "Home", "News"]), [
    "Home",
    "Blog",
    "News",
    "Works",
  ]);
});

test("shared-ts-facades: rank function prefers title match over content-only match", () => {
  const titleHit = scoreSearchResult({
    title: "AI Safety Notes",
    route: "/blog/ai-safety-notes",
    text: "Random text",
    query: "ai safety",
  });

  const contentOnlyHit = scoreSearchResult({
    title: "Weekly update",
    route: "/news",
    text: "This post mentions ai safety in the middle of content",
    query: "ai safety",
  });

  assert.equal(typeof titleHit, "number");
  assert.equal(typeof contentOnlyHit, "number");
  assert.equal(titleHit < contentOnlyHit, true);
});
