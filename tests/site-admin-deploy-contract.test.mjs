import test from "node:test";
import assert from "node:assert/strict";

import {
  isSiteAdminDeployOk,
  parseSiteAdminDeployResult,
} from "../lib/site-admin/deploy-contract.ts";

test("site-admin-deploy-contract: parses valid success payload", () => {
  const parsed = parseSiteAdminDeployResult({
    ok: true,
    triggeredAt: "2026-02-15T20:00:00.000Z",
    status: 202,
  });
  assert.ok(parsed);
  assert.equal(parsed?.ok, true);
  if (!parsed || !isSiteAdminDeployOk(parsed)) throw new Error("Expected deploy success payload");
  assert.equal(parsed.status, 202);
  assert.equal(parsed.triggeredAt, "2026-02-15T20:00:00.000Z");
});

test("site-admin-deploy-contract: preserves api error payload", () => {
  const parsed = parseSiteAdminDeployResult({ ok: false, error: "Deploy hook is not configured" });
  assert.deepEqual(parsed, { ok: false, error: "Deploy hook is not configured" });
});

test("site-admin-deploy-contract: rejects malformed success payload", () => {
  const parsed = parseSiteAdminDeployResult({
    ok: true,
    triggeredAt: 123,
    status: "202",
  });
  assert.equal(parsed, null);
});

