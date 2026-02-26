import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.ts";
import { normalizeGithubUserList, parseGithubUserCsv } from "../lib/shared/github-users.ts";
import { deepMerge, isObject } from "../lib/shared/object-utils.ts";
import {
  canonicalizeRoutePath,
  compactId,
  normalizeRoutePath,
  slugify,
} from "../lib/shared/route-utils.ts";
import { groupLabelForRoutePath, sortGroupLabels } from "../lib/shared/search-group.ts";
import { escapeHtml, tokenizeQuery } from "../lib/shared/text-utils.ts";
import { scoreSearchResult } from "../lib/search/rank.ts";

test("shared-ts-facades: default site config exposes expected required keys", () => {
  assert.equal(typeof DEFAULT_SITE_CONFIG.siteName, "string");
  assert.equal(typeof DEFAULT_SITE_CONFIG.lang, "string");
  assert.equal(typeof DEFAULT_SITE_CONFIG.seo.ogImage, "string");
  assert.equal(typeof DEFAULT_SITE_CONFIG.seo.pageOverrides, "object");
  assert.equal(Array.isArray(DEFAULT_SITE_CONFIG.nav.top), true);
  assert.equal(Array.isArray(DEFAULT_SITE_CONFIG.nav.more), true);
  assert.equal(typeof DEFAULT_SITE_CONFIG.content.sitemapAutoExclude.enabled, "boolean");
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

test("shared-ts-facades: route/text utilities keep expected transformations", () => {
  assert.equal(slugify("  Hello, World!  "), "hello-world");
  assert.equal(normalizeRoutePath("blog/post-a/"), "/blog/post-a");
  assert.equal(canonicalizeRoutePath("/blog/list/post-a"), "/blog/post-a");
  assert.equal(canonicalizeRoutePath("/list/post-a"), "/blog/post-a");
  assert.equal(compactId("https://notion.so/page/12345678-1234-1234-1234-1234567890ab"), "123456781234123412341234567890ab");

  assert.equal(escapeHtml('<a href="/x">x</a>'), "&lt;a href=&quot;/x&quot;&gt;x&lt;/a&gt;");
  assert.deepEqual(tokenizeQuery("  one   two  three "), ["one", "two", "three"]);
});

test("shared-ts-facades: github-user helpers normalize + dedupe consistently", () => {
  assert.deepEqual(normalizeGithubUserList(["@Jinkunn", " jinkunn ", "", null, "@Jinkunn"]), [
    "jinkunn",
  ]);
  assert.deepEqual(parseGithubUserCsv(" @A, b ,, @a "), ["a", "b", "a"]);
});

test("shared-ts-facades: object utilities validate and merge deeply", () => {
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject(null), false);
  assert.equal(isObject(["a"]), false);

  const base = {
    seo: { title: "A", description: "B" },
    nav: { top: [{ href: "/", label: "Home" }] },
  };
  const patch = {
    seo: { title: "Updated" },
    nav: { more: [{ href: "/blog", label: "Blog" }] },
  };
  const out = deepMerge(base, patch);

  assert.equal(out.seo.title, "Updated");
  assert.equal(out.seo.description, "B");
  assert.deepEqual(out.nav.top, [{ href: "/", label: "Home" }]);
  assert.deepEqual(out.nav.more, [{ href: "/blog", label: "Blog" }]);
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
