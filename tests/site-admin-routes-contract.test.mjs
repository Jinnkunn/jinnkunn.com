import test from "node:test";
import assert from "node:assert/strict";

import {
  isSiteAdminRoutesOk,
  parseSiteAdminRoutesResult,
} from "../lib/site-admin/routes-contract.ts";

test("site-admin-routes-contract: parses valid success payload", () => {
  const parsed = parseSiteAdminRoutesResult({
    ok: true,
    adminPageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    databases: { overridesDbId: "ovr", protectedDbId: "prot" },
    overrides: [{ rowId: "1", pageId: "pid1", routePath: "/news", enabled: true }],
    protectedRoutes: [
      {
        rowId: "2",
        pageId: "pid2",
        path: "/teaching",
        mode: "prefix",
        auth: "github",
        enabled: true,
      },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminRoutesOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.overrides.length, 1);
  assert.equal(parsed.protectedRoutes.length, 1);
  assert.equal(parsed.protectedRoutes[0].auth, "github");
});

test("site-admin-routes-contract: parses success payload in data envelope", () => {
  const parsed = parseSiteAdminRoutesResult({
    ok: true,
    data: {
      adminPageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      databases: { overridesDbId: "ovr", protectedDbId: "prot" },
      overrides: [{ rowId: "1", pageId: "pid1", routePath: "/news", enabled: true }],
      protectedRoutes: [
        {
          rowId: "2",
          pageId: "pid2",
          path: "/teaching",
          mode: "prefix",
          auth: "github",
          enabled: true,
        },
      ],
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminRoutesOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.overrides.length, 1);
  assert.equal(parsed.protectedRoutes.length, 1);
  assert.equal(parsed.protectedRoutes[0].auth, "github");
});

test("site-admin-routes-contract: filters malformed list rows", () => {
  const parsed = parseSiteAdminRoutesResult({
    ok: true,
    adminPageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    databases: { overridesDbId: "ovr", protectedDbId: "prot" },
    overrides: [
      { rowId: "1", pageId: "pid1", routePath: "/news" },
      { rowId: "", pageId: "pid2", routePath: "/bad" },
    ],
    protectedRoutes: [
      { rowId: "2", pageId: "pid2", path: "/teaching", mode: "exact", auth: "password" },
      { rowId: "3", pageId: "", path: "/bad", mode: "prefix", auth: "github" },
      { rowId: "4", pageId: "pid4", path: "/bad-auth", mode: "prefix", auth: "typo" },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminRoutesOk(parsed)) throw new Error("Expected success payload");
  assert.equal(parsed.overrides.length, 1);
  assert.equal(parsed.protectedRoutes.length, 1);
});

test("site-admin-routes-contract: preserves api error payload", () => {
  const parsed = parseSiteAdminRoutesResult({ ok: false, error: "Unauthorized" });
  assert.deepEqual(parsed, { ok: false, error: "Unauthorized", code: "REQUEST_FAILED" });
});

test("site-admin-routes-contract: rejects malformed success envelope", () => {
  const parsed = parseSiteAdminRoutesResult({
    ok: true,
    adminPageId: "",
    databases: { overridesDbId: "ovr", protectedDbId: "prot" },
    overrides: [],
    protectedRoutes: [],
  });
  assert.equal(parsed, null);
});
