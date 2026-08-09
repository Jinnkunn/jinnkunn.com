// The write outbox replays a queued mutation with the Site Admin bearer token
// and the Cloudflare Access secret attached. It therefore has to obey exactly
// the same host allowlist and no-redirect policy as the live transport, and a
// refusal from that allowlist must never be mistaken for "offline" — otherwise
// the refusal itself is what queues the credentials for replay.
//
// The behavioural coverage lives in Rust (`outbox::tests`) and vitest
// (`untrusted-host.test.ts`); these are the structural invariants that keep
// the two paths from drifting apart again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), "utf8");
}

test("outbox enqueue refuses untrusted hosts before persisting a row", async () => {
  const outbox = await read("apps/workspace/src-tauri/src/outbox.rs");
  assert.match(outbox, /use crate::site_admin::\{[^}]*is_trusted_admin_host[^}]*\}/);

  const enqueue = outbox.slice(
    outbox.indexOf("pub async fn outbox_enqueue"),
    outbox.indexOf("pub async fn outbox_status"),
  );
  assert.ok(enqueue.length > 0, "outbox_enqueue not found");
  const gateAt = enqueue.indexOf("trusted_replay_url(");
  const insertAt = enqueue.indexOf("INSERT INTO write_outbox");
  assert.ok(gateAt >= 0, "outbox_enqueue must call trusted_replay_url");
  assert.ok(gateAt < insertAt, "the host check must run before the INSERT");
});

test("outbox drain reuses the hardened site-admin client and re-checks each row", async () => {
  const outbox = await read("apps/workspace/src-tauri/src/outbox.rs");
  const drain = outbox.slice(outbox.indexOf("pub async fn outbox_drain"));
  assert.ok(drain.length > 0, "outbox_drain not found");

  // A fresh default client follows up to 10 redirects, which would bounce the
  // credentials to an attacker-chosen Location.
  assert.doesNotMatch(drain, /reqwest::Client::builder\(\)/);
  assert.match(drain, /let client = http_client\(\);/);
  assert.match(drain, /trusted_replay_url\(&base_url, &path\)/);

  const siteAdmin = await read("apps/workspace/src-tauri/src/site_admin.rs");
  assert.match(siteAdmin, /pub\(crate\) fn http_client\(\)/);
  assert.match(siteAdmin, /\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(siteAdmin, /pub\(crate\) fn is_trusted_admin_host\(/);
});

// sync_pull is the third credentialed transport (bearer token + CF Access
// secret against /api/site-admin/sync/pull) and was the one left on a default
// reqwest client with no allowlist — 10 redirects and any host you like.
test("sync_pull obeys the same host allowlist and no-redirect client", async () => {
  const sync = await read("apps/workspace/src-tauri/src/sync.rs");
  assert.match(sync, /use crate::site_admin::\{[^}]*is_trusted_admin_host[^}]*\}/);
  assert.doesNotMatch(sync, /reqwest::Client::builder\(\)/);
  assert.match(sync, /let client = http_client\(\);/);

  const pull = sync.slice(sync.indexOf("pub async fn sync_pull"));
  const gateAt = pull.indexOf("is_trusted_admin_host(");
  const sendAt = pull.indexOf(".send()");
  assert.ok(gateAt >= 0, "sync_pull must check the host allowlist");
  assert.ok(gateAt < sendAt, "the host check must run before the first request");
});

test("an allowlist refusal is not classified as offline in the site-admin frontend", async () => {
  const api = await read("apps/workspace/src/surfaces/site-admin/api.ts");
  assert.match(api, /export function isUntrustedHostRejection\(/);
  assert.match(api, /isUntrustedHostRejection\(message\)\s*\?\s*"UNTRUSTED_HOST"/);

  const state = await read("apps/workspace/src/surfaces/site-admin/state.tsx");
  const outboxGuard = state.slice(state.indexOf("const looksOffline ="));
  assert.match(
    outboxGuard.slice(0, 400),
    /!isUntrustedHostRejection\(response\.error\)/,
    "the outbox enqueue path must exclude host-allowlist refusals",
  );
});
