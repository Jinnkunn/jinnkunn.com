import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBreadcrumb,
  buildGroupCounts,
  buildSnippetByTerms,
  classifyType,
  dedupeByCanonicalRoute,
  isIgnoredPath,
  matchTypeKey,
  normalizeKindForTypeKey,
  normalizeQuery,
  tokenizeSearchQuery,
} from "../lib/search/api-model.ts";

test("search-api-model: normalizeQuery trims, compacts spaces, and caps length", () => {
  assert.equal(normalizeQuery("  aaa   bbb  "), "aaa bbb");
  assert.equal(normalizeQuery("x".repeat(250)).length, 200);
});

test("search-api-model: classifyType handles blog/database helpers", () => {
  assert.equal(classifyType("database", "/any"), "databases");
  assert.equal(classifyType("page", "/blog/post-a"), "blog");
  assert.equal(classifyType("page", "/blog/list/post-a"), "databases");
  assert.equal(classifyType("page", "/news"), "pages");
});

test("search-api-model: matchTypeKey and normalizeKindForTypeKey map synonyms consistently", () => {
  assert.equal(matchTypeKey("page", "pages"), true);
  assert.equal(matchTypeKey("pages", "pages"), true);
  assert.equal(matchTypeKey("database", "databases"), true);
  assert.equal(matchTypeKey("blog", "pages"), false);

  assert.equal(normalizeKindForTypeKey("pages"), "page");
  assert.equal(normalizeKindForTypeKey("blog"), "blog");
  assert.equal(normalizeKindForTypeKey("databases"), "database");
});

test("search-api-model: buildBreadcrumb hides internal list nodes", () => {
  const home = { id: "home", routePath: "/", title: "Hi there!", kind: "page" };
  const blog = { id: "blog", parentId: "home", routePath: "/blog", title: "Blog", kind: "page" };
  const list = { id: "list", parentId: "blog", routePath: "/blog/list", title: "List", kind: "database" };
  const post = {
    id: "post",
    parentId: "list",
    routePath: "/blog/list/post-a",
    title: "Post A",
    kind: "page",
  };

  const byRoute = new Map([
    ["/", home],
    ["/blog", blog],
    ["/blog/list", list],
    ["/blog/list/post-a", post],
  ]);
  const byId = new Map([
    ["home", home],
    ["blog", blog],
    ["list", list],
    ["post", post],
  ]);

  assert.equal(buildBreadcrumb("/blog/list/post-a", byRoute, byId), "Home / Blog / Post A");
});

test("search-api-model: buildGroupCounts stays deterministic", () => {
  assert.deepEqual(buildGroupCounts(["Blog", "Home", "Blog", "News"]), [
    { label: "Home", count: 1 },
    { label: "Blog", count: 2 },
    { label: "News", count: 1 },
  ]);
});

test("search-api-model: dedupeByCanonicalRoute keeps first scored entry per route", () => {
  const rows = [
    { canon: "/blog/a", score: 1, id: "x1" },
    { canon: "/blog/a", score: 2, id: "x2" },
    { canon: "/blog/b", score: 1, id: "y1" },
  ];
  const out = dedupeByCanonicalRoute(rows);
  assert.deepEqual(
    out.map((it) => it.id),
    ["x1", "y1"],
  );
});

test("search-api-model: snippet and tokenization helpers return stable output", () => {
  const terms = tokenizeSearchQuery("reasoning drift");
  assert.deepEqual(terms, ["reasoning", "drift"]);

  const snippet = buildSnippetByTerms(
    "This article studies why reasoning drift appears under retrieval perturbation.",
    terms,
  );
  assert.equal(typeof snippet, "string");
  assert.equal(snippet.length > 0, true);
  const snippetLower = snippet.toLowerCase();
  assert.equal(snippetLower.includes("reasoning") || snippetLower.includes("drift"), true);
});

test("search-api-model: ignored paths exclude admin/api/internal routes", () => {
  assert.equal(isIgnoredPath("/site-admin/routes"), true);
  assert.equal(isIgnoredPath("/api/search"), true);
  assert.equal(isIgnoredPath("/_next/static/chunk.js"), true);
  assert.equal(isIgnoredPath("/blog/list"), true);
  assert.equal(isIgnoredPath("/publications"), false);
});
