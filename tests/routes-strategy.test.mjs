import test from "node:test";
import assert from "node:assert/strict";

import {
  buildParentByPageIdMap,
  blogSourceRouteForPublicPath,
  canonicalizePublicRoute,
  findProtectedByPageHierarchy,
  findProtectedMatch,
  pickProtectedRule,
  lookupPageIdForPath,
  normalizePathname,
  resolveNotionIdPathRedirect,
} from "../lib/routes/strategy.mjs";

test("normalizePathname()", () => {
  assert.equal(normalizePathname(""), "/");
  assert.equal(normalizePathname(" / "), "/");
  assert.equal(normalizePathname("/a/"), "/a");
  assert.equal(normalizePathname("/a/b///"), "/a/b//"); // only strips a single trailing slash
});

test("canonicalizePublicRoute()", () => {
  assert.equal(canonicalizePublicRoute("/blog/list"), "/blog");
  assert.equal(canonicalizePublicRoute("/blog/list/foo"), "/blog/foo");
  assert.equal(canonicalizePublicRoute("/list/foo"), "/blog/foo");
  assert.equal(canonicalizePublicRoute("/list"), "/blog");
  assert.equal(canonicalizePublicRoute("/blog/foo"), "/blog/foo");
});

test("resolveNotionIdPathRedirect()", () => {
  const pageIdToRoute = { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": "/news/" };
  assert.equal(resolveNotionIdPathRedirect("/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", pageIdToRoute), "/news");
  assert.equal(resolveNotionIdPathRedirect("/bbbb", pageIdToRoute), "");
});

test("lookupPageIdForPath() maps canonical /blog/<slug> to backing /blog/list/<slug>", () => {
  const routes = {
    "/blog/list/my-post": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.equal(lookupPageIdForPath("/blog/my-post", routes), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("blogSourceRouteForPublicPath()", () => {
  assert.equal(blogSourceRouteForPublicPath("/blog/my-post"), "/blog/list/my-post");
  assert.equal(blogSourceRouteForPublicPath("/blog/list/my-post"), "/blog/list/my-post"); // canonicalized first
  assert.equal(blogSourceRouteForPublicPath("/works"), "");
});

test("findProtectedMatch(): exact protects subtree", () => {
  const rules = [
    { id: "1", path: "/teaching", mode: "exact", token: "x" },
  ];
  assert.equal(findProtectedMatch("/teaching", rules)?.id, "1");
  assert.equal(findProtectedMatch("/teaching/archive", rules)?.id, "1");
  assert.equal(findProtectedMatch("/other", rules), null);
});

test("findProtectedByPageHierarchy(): returns nearest protected ancestor", () => {
  const pageId = "cccccccccccccccccccccccccccccccc";
  const parentByPageId = {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "",
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    cccccccccccccccccccccccccccccccc: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const rules = [
    {
      id: "r-home",
      key: "pageId",
      pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: "/",
      mode: "prefix",
      token: "h",
      auth: "password",
    },
    {
      id: "r-teaching",
      key: "pageId",
      pageId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      path: "/teaching",
      mode: "prefix",
      token: "t",
      auth: "github",
    },
  ];

  assert.equal(findProtectedByPageHierarchy(pageId, rules, parentByPageId)?.id, "r-teaching");
});

test("buildParentByPageIdMap(): normalizes dashed ids from routes-manifest", () => {
  const parentByPageId = buildParentByPageIdMap([
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      parentId: "",
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      parentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    },
  ]);

  assert.deepEqual(parentByPageId, {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "",
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
});

test("pickProtectedRule(): prefers page hierarchy rule over path match", () => {
  const rules = [
    {
      id: "by-path",
      key: "path",
      path: "/blog",
      mode: "prefix",
      token: "p",
      auth: "password",
    },
    {
      id: "by-page",
      key: "pageId",
      pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: "/works",
      mode: "prefix",
      token: "g",
      auth: "github",
    },
  ];
  const routesMap = {
    "/blog/list/post-a": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const parentByPageId = {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: "",
  };

  const out = pickProtectedRule("/blog/post-a", rules, routesMap, parentByPageId);
  assert.equal(out?.id, "by-page");
});

test("pickProtectedRule(): falls back to longest prefix path match", () => {
  const rules = [
    { id: "r1", path: "/teaching", mode: "prefix", token: "1" },
    { id: "r2", path: "/teaching/archive", mode: "prefix", token: "2" },
  ];

  const out = pickProtectedRule("/teaching/archive/2024-25-fall", rules, {}, {});
  assert.equal(out?.id, "r2");
});
