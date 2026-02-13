import test from "node:test";
import assert from "node:assert/strict";

import {
  emptySearchResponse,
  normalizeSearchKind,
  parseSearchItem,
  parseSearchMeta,
  parseSearchResponse,
} from "../lib/shared/search-contract.mjs";

test("search-contract: normalize kind with strict fallback", () => {
  assert.equal(normalizeSearchKind("page"), "page");
  assert.equal(normalizeSearchKind("BLOG"), "blog");
  assert.equal(normalizeSearchKind("database"), "database");
  assert.equal(normalizeSearchKind("unknown"), "page");
});

test("search-contract: parseSearchItem rejects invalid routes", () => {
  assert.equal(parseSearchItem(null), null);
  assert.equal(parseSearchItem({ routePath: "blog/post" }), null);
  const item = parseSearchItem({ title: "x", routePath: "/blog/post", kind: "blog" });
  assert.equal(item?.routePath, "/blog/post");
  assert.equal(item?.kind, "blog");
});

test("search-contract: parseSearchMeta validates required numeric fields", () => {
  const bad = parseSearchMeta({ total: "n/a" });
  assert.equal(bad, null);

  const meta = parseSearchMeta({
    total: 3,
    filteredTotal: 2,
    counts: { all: 3, pages: 1, blog: 1, databases: 1 },
    groups: [{ label: "Blog", count: 1 }, { label: "Pages", count: 1 }],
    offset: 0,
    limit: 20,
    hasMore: false,
  });
  assert.ok(meta);
  assert.equal(meta?.counts.all, 3);
  assert.equal(meta?.groups?.length, 2);
});

test("search-contract: parseSearchResponse filters malformed items", () => {
  const out = parseSearchResponse({
    items: [
      { title: "ok", routePath: "/ok", kind: "page" },
      { title: "bad", routePath: "bad/no-leading-slash", kind: "page" },
    ],
    meta: {
      total: 2,
      filteredTotal: 1,
      counts: { all: 2, pages: 1, blog: 1, databases: 0 },
      offset: 0,
      limit: 20,
      hasMore: false,
    },
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].routePath, "/ok");
  assert.ok(out.meta);
});

test("search-contract: empty response uses deterministic shape", () => {
  const out = emptySearchResponse({ limit: 15 });
  assert.equal(out.items.length, 0);
  assert.equal(out.meta?.limit, 15);
  assert.equal(out.meta?.counts.blog, 0);
});
