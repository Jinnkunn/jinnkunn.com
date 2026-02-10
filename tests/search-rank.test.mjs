import test from "node:test";
import assert from "node:assert/strict";

import { scoreSearchResult } from "../lib/search/rank.mjs";

test("search-rank: title matches outrank content-only matches", () => {
  const q = "reasoning drift";

  const a = scoreSearchResult({
    title: "Measuring Reasoning Drift",
    route: "/blog/measuring-reasoning-drift",
    text: "long content ... reasoning drift appears later ...",
    query: q,
  });

  const b = scoreSearchResult({
    title: "Some Unrelated Title",
    route: "/blog/some-unrelated-title",
    text: "long content ... reasoning drift appears later ...",
    query: q,
  });

  assert.ok(a < b);
});

test("search-rank: navBoost improves ranking", () => {
  const q = "publications";
  const base = scoreSearchResult({
    title: "Publications",
    route: "/publications",
    text: "",
    query: q,
  });
  const boosted = scoreSearchResult({
    title: "Publications",
    route: "/publications",
    text: "",
    query: q,
    navBoost: 180,
  });
  assert.ok(boosted < base);
});

test("search-rank: route matches outrank deep matches with same title", () => {
  const q = "teaching";
  const shallow = scoreSearchResult({
    title: "Teaching",
    route: "/teaching",
    text: "",
    query: q,
  });
  const deep = scoreSearchResult({
    title: "Teaching",
    route: "/teaching/archive/2024-25-fall/csci3141",
    text: "",
    query: q,
  });
  assert.ok(shallow < deep);
});

