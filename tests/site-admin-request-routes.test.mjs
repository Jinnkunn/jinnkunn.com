import test from "node:test";
import assert from "node:assert/strict";

import { parseSiteAdminRoutesCommand } from "../lib/site-admin/routes-command.ts";

test("site-admin-request routes: override normalizes route path", () => {
  const parsed = parseSiteAdminRoutesCommand({
    kind: "override",
    pageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    routePath: "news/latest/",
    expectedSiteConfigSha: "site-sha",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("expected success");
  assert.deepEqual(parsed.value, {
    kind: "override",
    pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    routePath: "/news/latest",
    expectedSiteConfigSha: "site-sha",
  });
});

test("site-admin-request routes: override allows empty route path to disable override", () => {
  const parsed = parseSiteAdminRoutesCommand({
    kind: "override",
    pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    routePath: "   ",
    expectedSiteConfigSha: "site-sha",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("expected success");
  assert.equal(parsed.value.kind, "override");
  assert.equal(parsed.value.routePath, "");
  assert.equal(parsed.value.expectedSiteConfigSha, "site-sha");
});

test("site-admin-request routes: protected normalizes path and defaults to password auth", () => {
  const parsed = parseSiteAdminRoutesCommand({
    kind: "protected",
    pageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    path: "teaching/archive/",
    auth: "unknown",
    expectedProtectedRoutesSha: "protected-sha",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("expected success");
  assert.deepEqual(parsed.value, {
    kind: "protected",
    pageId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    path: "/teaching/archive",
    authKind: "password",
    password: "",
    expectedProtectedRoutesSha: "protected-sha",
  });
});

test("site-admin-request routes: github/public auth rejects password payload", () => {
  const github = parseSiteAdminRoutesCommand({
    kind: "protected",
    pageId: "cccccccccccccccccccccccccccccccc",
    path: "/works",
    auth: "github",
    password: "secret",
    expectedProtectedRoutesSha: "protected-sha",
  });
  assert.deepEqual(github, {
    ok: false,
    error: "GitHub auth does not use a password",
    status: 400,
  });

  const publicAuth = parseSiteAdminRoutesCommand({
    kind: "protected",
    pageId: "cccccccccccccccccccccccccccccccc",
    path: "/works",
    auth: "public",
    password: "secret",
    expectedProtectedRoutesSha: "protected-sha",
  });
  assert.deepEqual(publicAuth, {
    ok: false,
    error: "Public auth does not use a password",
    status: 400,
  });
});

test("site-admin-request routes: protected validates required fields", () => {
  const missingPageId = parseSiteAdminRoutesCommand({
    kind: "protected",
    path: "/works",
    auth: "password",
    expectedProtectedRoutesSha: "protected-sha",
  });
  assert.deepEqual(missingPageId, {
    ok: false,
    error: "Missing pageId",
    status: 400,
  });

  const missingPath = parseSiteAdminRoutesCommand({
    kind: "protected",
    pageId: "dddddddddddddddddddddddddddddddd",
    path: " ",
    auth: "password",
    expectedProtectedRoutesSha: "protected-sha",
  });
  assert.deepEqual(missingPath, {
    ok: false,
    error: "Missing path",
    status: 400,
  });
});
