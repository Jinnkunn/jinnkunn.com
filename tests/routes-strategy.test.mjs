import test from "node:test";
import assert from "node:assert/strict";

import {
  blogSourceRouteForPublicPath,
  canonicalizePublicRoute,
  findProtectedMatch,
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

