import assert from "node:assert/strict";
import test from "node:test";

import { buildSearchResponse } from "../lib/search/api-service.ts";

function manifestRow(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind ?? "page",
    routePath: row.routePath,
    parentId: row.parentId ?? "",
    parentRoutePath: row.parentRoutePath ?? "/",
    navGroup: row.navGroup ?? "",
  };
}

test("search-api-service: index path wins and canonical blog/list routes are deduped", () => {
  const manifest = [
    manifestRow({ id: "home", title: "Hi there!", routePath: "/" }),
    manifestRow({ id: "blog", title: "Blog", routePath: "/blog", parentId: "home" }),
    manifestRow({ id: "list", title: "List", routePath: "/blog/list", parentId: "blog", kind: "database" }),
    manifestRow({
      id: "post",
      title: "Post A",
      routePath: "/blog/list/post-a",
      parentId: "list",
      parentRoutePath: "/blog/list",
    }),
  ];
  const index = [
    {
      routePath: "/blog/list/post-a",
      title: "Post A",
      kind: "page",
      text: "Reasoning drift on token probabilities",
      headings: ["Post A"],
    },
    {
      routePath: "/blog/post-a",
      title: "Post A",
      kind: "page",
      text: "Reasoning drift follow-up",
      headings: ["Post A"],
    },
  ];

  const out = buildSearchResponse({
    q: "reasoning drift",
    type: "all",
    offset: 0,
    limit: 20,
    scope: "",
    index,
    manifest,
  });

  assert.equal(out.meta.total, 1);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].routePath, "/blog/post-a");
});

test("search-api-service: manifest fallback keeps clean breadcrumb without list helper", () => {
  const manifest = [
    manifestRow({ id: "home", title: "Hi there!", routePath: "/" }),
    manifestRow({ id: "blog", title: "Blog", routePath: "/blog", parentId: "home" }),
    manifestRow({ id: "list", title: "List", routePath: "/blog/list", parentId: "blog", kind: "database" }),
    manifestRow({
      id: "post",
      title: "Post A",
      routePath: "/blog/list/post-a",
      parentId: "list",
      parentRoutePath: "/blog/list",
    }),
  ];

  const out = buildSearchResponse({
    q: "post a",
    type: "all",
    offset: 0,
    limit: 20,
    scope: "",
    index: [],
    manifest,
  });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].breadcrumb, "Home / Blog / Post A");
});

test("search-api-service: scope and type filters are both enforced", () => {
  const manifest = [
    manifestRow({ id: "home", title: "Hi there!", routePath: "/" }),
    manifestRow({ id: "works", title: "Works", routePath: "/works", parentId: "home" }),
    manifestRow({ id: "blog", title: "Blog", routePath: "/blog", parentId: "home" }),
    manifestRow({ id: "post", title: "Post A", routePath: "/blog/post-a", parentId: "blog" }),
  ];
  const index = [
    { routePath: "/works", title: "Works", kind: "page", text: "Part-time instructor role", headings: [] },
    { routePath: "/blog/post-a", title: "Post A", kind: "page", text: "Part-time thoughts", headings: [] },
  ];

  const out = buildSearchResponse({
    q: "part-time",
    type: "blog",
    offset: 0,
    limit: 20,
    scope: "/blog",
    index,
    manifest,
  });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].routePath, "/blog/post-a");
  assert.equal(out.meta.counts.blog, 1);
});

test("search-api-service: groups use type + section labels with counts", () => {
  const manifest = [
    manifestRow({ id: "home", title: "Hi there!", routePath: "/" }),
    manifestRow({ id: "works", title: "Works", routePath: "/works", parentId: "home" }),
    manifestRow({ id: "blog", title: "Blog", routePath: "/blog", parentId: "home" }),
    manifestRow({ id: "post", title: "Post A", routePath: "/blog/post-a", parentId: "blog" }),
  ];
  const index = [
    { routePath: "/works", title: "Works", kind: "page", text: "reasoning drift", headings: ["Works"] },
    { routePath: "/blog/post-a", title: "Post A", kind: "page", text: "reasoning drift", headings: ["Post A"] },
  ];

  const out = buildSearchResponse({
    q: "reasoning drift",
    type: "all",
    offset: 0,
    limit: 20,
    scope: "",
    index,
    manifest,
  });

  assert.deepEqual(
    out.meta.groups,
    [
      { label: "Blog", count: 1 },
      { label: "Pages / Works", count: 1 },
    ],
  );
});

test("search-api-service: heading match outranks body-only match", () => {
  const manifest = [
    manifestRow({ id: "a", title: "Page A", routePath: "/a" }),
    manifestRow({ id: "b", title: "Page B", routePath: "/b" }),
  ];
  const index = [
    {
      routePath: "/a",
      title: "Page A",
      kind: "page",
      text: "unrelated body",
      headings: ["Reasoning Drift"],
    },
    {
      routePath: "/b",
      title: "Page B",
      kind: "page",
      text: "reasoning drift appears in body text only",
      headings: ["Background"],
    },
  ];

  const out = buildSearchResponse({
    q: "reasoning drift",
    type: "all",
    offset: 0,
    limit: 20,
    scope: "",
    index,
    manifest,
  });

  assert.equal(out.items[0]?.routePath, "/a");
});
