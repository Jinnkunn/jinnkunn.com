import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizePublicRoute,
  lookupPageIdForPath,
  findProtectedMatch,
  blogSourceRouteForPublicPath,
} from "../lib/routes/strategy.ts";
import { canonicalizeBlogHrefsInHtml } from "../lib/routes/html-rewrite.ts";

test("routes-ts-facades: canonicalizePublicRoute keeps blog canonical mapping", () => {
  assert.equal(canonicalizePublicRoute("/blog/list/hello"), "/blog/hello");
  assert.equal(canonicalizePublicRoute("/list/hello"), "/blog/hello");
  assert.equal(canonicalizePublicRoute("/blog"), "/blog");
});

test("routes-ts-facades: lookupPageIdForPath maps canonical blog route back to source route", () => {
  const routesMap = {
    "/blog/list/post-a": "11111111111111111111111111111111",
  };
  assert.equal(
    lookupPageIdForPath("/blog/post-a", routesMap),
    "11111111111111111111111111111111",
  );
  assert.equal(blogSourceRouteForPublicPath("/blog/post-a"), "/blog/list/post-a");
});

test("routes-ts-facades: findProtectedMatch preserves exact-subtree rule behavior", () => {
  const rules = [
    {
      id: "r1",
      path: "/teaching",
      mode: "exact",
      token: "pw",
      auth: "password",
    },
  ];

  const hit = findProtectedMatch("/teaching/archive", rules);
  assert.equal(hit?.id, "r1");
});

test("routes-ts-facades: html rewrite canonicalizes list hrefs", () => {
  const html = '<a href="/blog/list/hello">Hello</a>';
  const out = canonicalizeBlogHrefsInHtml(html);
  assert.equal(out, '<a href="/blog/hello">Hello</a>');
});
