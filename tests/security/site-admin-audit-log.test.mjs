import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importServerModule } from "../helpers/server-module-hooks.mjs";

const { hasSiteAdminAuditD1Fallback, isWorkersRuntimeLike, writeSiteAdminAuditLog } =
  await importServerModule("lib/server/site-admin-audit-log.ts");

const D1_ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
  "SITE_ADMIN_AUDIT_D1_DATABASE_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
];

function withoutD1Env(fn) {
  const saved = new Map(D1_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of D1_ENV_KEYS) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function asWorkersRuntime(fn) {
  // The detector looks for workerd-only globals; fake one rather than
  // requiring workerd in the test process.
  const had = Object.prototype.hasOwnProperty.call(globalThis, "WebSocketPair");
  const previous = globalThis.WebSocketPair;
  globalThis.WebSocketPair = function WebSocketPair() {};
  try {
    return fn();
  } finally {
    if (had) globalThis.WebSocketPair = previous;
    else delete globalThis.WebSocketPair;
  }
}

const sampleEvent = {
  action: "app-auth.token.issue",
  result: "success",
  actor: "tester",
  endpoint: "/api/site-admin/app-auth/authorize",
  method: "GET",
  status: 302,
};

test("isWorkersRuntimeLike: detects workerd by user agent or platform globals", () => {
  assert.equal(isWorkersRuntimeLike({ navigator: { userAgent: "Cloudflare-Workers" } }), true);
  assert.equal(isWorkersRuntimeLike({ WebSocketPair: function () {} }), true);
  assert.equal(isWorkersRuntimeLike({ caches: { default: {} } }), true);
  assert.equal(isWorkersRuntimeLike({ navigator: { userAgent: "Node.js" } }), false);
  assert.equal(isWorkersRuntimeLike({}), false);
});

test("hasSiteAdminAuditD1Fallback: reports true when D1 is simply not configured", () => {
  withoutD1Env(() => {
    assert.equal(hasSiteAdminAuditD1Fallback(), true);
  });
});

test("audit log: on workerd with no D1 the event is surfaced, not silently dropped", async () => {
  const result = await withoutD1Env(() => asWorkersRuntime(() => writeSiteAdminAuditLog(sampleEvent)));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "d1-unconfigured");
});

test("audit log: on Node with no D1 the event still lands in the local file sink", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sink-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const result = await withoutD1Env(() => writeSiteAdminAuditLog(sampleEvent));
    assert.equal(result.ok, true);
    assert.equal(result.sink, "file");
    const file = path.join(dir, "content", "generated", "site-admin-audit.log.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const written = JSON.parse(lines[lines.length - 1]);
    assert.equal(written.action, "app-auth.token.issue");
    assert.equal(written.actor, "tester");
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("audit log: auth.denied is an accepted action type", async () => {
  const result = await withoutD1Env(() =>
    asWorkersRuntime(() =>
      writeSiteAdminAuditLog({
        ...sampleEvent,
        action: "auth.denied",
        result: "error",
        status: 200,
        code: "CROSS_SITE_TOKEN_REQUEST",
      }),
    ),
  );
  assert.equal(result.ok, false);
});
