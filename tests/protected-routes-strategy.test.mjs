import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParentByPageIdMap,
  findProtectedByPageHierarchy,
  findProtectedMatch,
  pickProtectedRule,
  resolveNotionIdPathRedirect,
} from "../lib/routes/strategy.ts";

const RULE_EXACT_ABOUT = {
  id: "about",
  path: "/about",
  mode: "exact",
  token: "t-about",
  auth: "password",
};

const RULE_PREFIX_NOTES = {
  id: "notes-root",
  path: "/notes",
  mode: "prefix",
  token: "t-notes",
  auth: "password",
};

const RULE_PREFIX_NOTES_DEEP = {
  id: "notes-deep",
  path: "/notes/research",
  mode: "prefix",
  token: "t-notes-deep",
  auth: "github",
};

const RULE_BY_PAGE_ID = {
  id: "page-id-rule",
  path: "/ignored",
  mode: "exact",
  token: "t-by-id",
  auth: "github",
  key: "pageId",
  pageId: "00000000000000000000000000000042",
};

test("findProtectedMatch: exact rule matches same path and sub-paths", () => {
  const hit = findProtectedMatch("/about", [RULE_EXACT_ABOUT]);
  assert.equal(hit?.id, "about");

  const subPath = findProtectedMatch("/about/team", [RULE_EXACT_ABOUT]);
  assert.equal(subPath?.id, "about");
});

test("findProtectedMatch: prefix picks the longest (most specific) match", () => {
  const hit = findProtectedMatch("/notes/research/topic", [
    RULE_PREFIX_NOTES,
    RULE_PREFIX_NOTES_DEEP,
  ]);
  assert.equal(hit?.id, "notes-deep");

  const shallow = findProtectedMatch("/notes/other", [
    RULE_PREFIX_NOTES,
    RULE_PREFIX_NOTES_DEEP,
  ]);
  assert.equal(shallow?.id, "notes-root");
});

test("findProtectedMatch: prefix `/` does not match everything", () => {
  const rootRule = {
    id: "root",
    path: "/",
    mode: "prefix",
    token: "t-root",
  };
  const hit = findProtectedMatch("/public", [rootRule]);
  assert.equal(hit, null);
});

test("findProtectedMatch: returns null when no rule matches", () => {
  const hit = findProtectedMatch("/public", [RULE_EXACT_ABOUT, RULE_PREFIX_NOTES]);
  assert.equal(hit, null);
});

test("buildParentByPageIdMap + findProtectedByPageHierarchy: ancestor rule wins", () => {
  const manifest = [
    { id: "00000000000000000000000000000042", parentId: null },
    { id: "00000000000000000000000000000100", parentId: "00000000000000000000000000000042" },
  ];
  const parentByPageId = buildParentByPageIdMap(manifest);

  const hit = findProtectedByPageHierarchy(
    "00000000000000000000000000000100",
    [RULE_BY_PAGE_ID],
    parentByPageId,
  );
  assert.equal(hit?.id, "page-id-rule");
});

test("pickProtectedRule: prefers pageId hierarchy match over path match", () => {
  const routesMap = { "/private": "00000000000000000000000000000100" };
  const parentByPageId = buildParentByPageIdMap([
    { id: "00000000000000000000000000000042", parentId: null },
    { id: "00000000000000000000000000000100", parentId: "00000000000000000000000000000042" },
  ]);

  const hit = pickProtectedRule(
    "/private",
    [RULE_BY_PAGE_ID, RULE_EXACT_ABOUT],
    routesMap,
    parentByPageId,
  );
  assert.equal(hit?.id, "page-id-rule");
});

test("pickProtectedRule: falls back to path-based rule when no pageId match", () => {
  const hit = pickProtectedRule(
    "/about/team",
    [RULE_BY_PAGE_ID, RULE_EXACT_ABOUT],
    {},
    {},
  );
  assert.equal(hit?.id, "about");
});

test("resolveNotionIdPathRedirect: maps /<32-hex> to canonical route", () => {
  const map = { "0123456789abcdef0123456789abcdef": "/blog/hello" };
  const target = resolveNotionIdPathRedirect(
    "/0123456789abcdef0123456789abcdef",
    map,
  );
  assert.equal(target, "/blog/hello");
});

test("resolveNotionIdPathRedirect: returns empty for non-id paths or unknown ids", () => {
  assert.equal(resolveNotionIdPathRedirect("/blog", {}), "");
  assert.equal(
    resolveNotionIdPathRedirect("/0123456789abcdef0123456789abcdef", {}),
    "",
  );
});
