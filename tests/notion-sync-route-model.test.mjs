import test from "node:test";
import assert from "node:assert/strict";

import {
  assignRoutes,
  canonicalizePublicHref,
  flattenPages,
  pickHomePageId,
  routePathToHtmlRel,
} from "../scripts/notion-sync/route-model.mjs";

test("route-model: pickHomePageId prefers configured id", () => {
  const nodes = [
    { id: "1".repeat(32), kind: "page", title: "Foo", children: [] },
    { id: "2".repeat(32), kind: "page", title: "Home", children: [] },
  ];
  const cfg = { content: { homePageId: "2".repeat(32) } };
  assert.equal(pickHomePageId(nodes, cfg), "2".repeat(32));
});

test("route-model: assignRoutes assigns / to home and nested paths to children", () => {
  const homeId = "a".repeat(32);
  const otherId = "b".repeat(32);
  const childId = "c".repeat(32);

  const nodes = [
    { id: homeId, kind: "page", title: "Home", children: [] },
    {
      id: otherId,
      kind: "page",
      title: "Home",
      children: [{ id: childId, kind: "page", title: "Child", children: [] }],
    },
  ];

  const overrides = new Map([[otherId, "/news/"]]);
  assignRoutes(nodes, { homePageId: homeId, routeOverrides: overrides });

  assert.equal(nodes[0].routePath, "/");
  assert.deepEqual(nodes[0].routeSegments, []);

  // override normalized (trailing slash removed)
  assert.equal(nodes[1].routePath, "/news");
  assert.deepEqual(nodes[1].routeSegments, ["news"]);

  // child continues under parent
  assert.equal(nodes[1].children[0].routePath, "/news/child");
});

test("route-model: flattenPages returns depth-first list", () => {
  const nodes = [
    {
      id: "1".repeat(32),
      title: "A",
      children: [{ id: "2".repeat(32), title: "B", children: [] }],
    },
  ];
  const flat = flattenPages(nodes);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].title, "A");
  assert.equal(flat[1].title, "B");
});

test("route-model: routePathToHtmlRel maps / to index.html", () => {
  assert.equal(routePathToHtmlRel("/"), "index.html");
  assert.equal(routePathToHtmlRel("/blog/foo"), "blog/foo.html");
});

test("route-model: canonicalizePublicHref canonicalizes blog list routes only for internal paths", () => {
  assert.equal(canonicalizePublicHref("/blog/list/hello"), "/blog/hello");
  assert.equal(canonicalizePublicHref("/list/hello"), "/blog/hello");
  assert.equal(canonicalizePublicHref("https://example.com/list/hello"), "https://example.com/list/hello");
});

