// The single-file content endpoints (/now, /home, /calendar-public) had no
// response contract: their payload types were hand-copied into each client and
// described a flat `{ ok, data }` body that the server never sends. The real
// body nests — `{ ok: true, data: { data, sourceVersion } }` — which is why
// the desktop client guesses with `data ?? body` and the iOS client throws on
// a null `data`.
//
// Every fixture here is built the way the route builds it: the checked-in
// content file, through the same normaliser the service uses, wrapped in the
// same `apiPayloadOk` envelope, round-tripped through JSON.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  isSiteAdminContentOk,
  parseSiteAdminCalendarPublicGet,
  parseSiteAdminCalendarPublicLiveGet,
  parseSiteAdminCalendarPublicLivePost,
  parseSiteAdminCalendarPublicPost,
  parseSiteAdminHomeGet,
  parseSiteAdminHomePost,
  parseSiteAdminNowGet,
  parseSiteAdminNowPost,
} from "../../lib/site-admin/content-contract.ts";
import { normalizeNowData } from "../../lib/site-admin/now-normalize.ts";
import { normalizeHomeData } from "../../lib/site-admin/home-normalize.ts";
import {
  normalizePublicCalendarData,
  publicCalendarJson,
} from "../../lib/shared/public-calendar.ts";

const ROOT = process.cwd();

async function readContentJson(rel) {
  return JSON.parse(await readFile(path.join(ROOT, "content", rel), "utf8"));
}

/** `apiPayloadOk(payload)` -> `{ ok: true, data: payload }`, serialised. */
function recordedResponse(payload) {
  return JSON.parse(JSON.stringify({ ok: true, data: payload }));
}

test("content-contract: parses a recorded /now GET response", async () => {
  const raw = await readContentJson("now.json");
  const fileSha = createHash("sha1")
    .update(`${JSON.stringify(normalizeNowData(raw), null, 2)}\n`, "utf8")
    .digest("hex");
  const body = recordedResponse({
    data: normalizeNowData(raw),
    sourceVersion: { fileSha },
  });

  // The shape the old types claimed (flat `data`) is not what ships.
  assert.ok(body.data.data, "the payload's own data field is nested one level");
  assert.equal(body.data.sourceVersion.fileSha, fileSha);

  const parsed = parseSiteAdminNowGet(body);
  assert.ok(parsed && isSiteAdminContentOk(parsed));
  assert.equal(parsed.data.current.text, raw.current.text);
  assert.equal(parsed.data.updates.length, normalizeNowData(raw).updates.length);
  assert.equal(parsed.sourceVersion.fileSha, fileSha);
});

test("content-contract: /now POST echoes the document and parses the same way", async () => {
  const raw = await readContentJson("now.json");
  const parsed = parseSiteAdminNowPost(
    recordedResponse({
      data: normalizeNowData(raw),
      sourceVersion: { fileSha: "abc123" },
    }),
  );
  assert.ok(parsed && isSiteAdminContentOk(parsed));
  assert.equal(parsed.sourceVersion.fileSha, "abc123");
});

test("content-contract: parses a recorded /home GET + POST response", async () => {
  const raw = await readContentJson("home.json");
  const get = parseSiteAdminHomeGet(
    recordedResponse({
      data: normalizeHomeData(raw),
      sourceVersion: { fileSha: "home-sha" },
    }),
  );
  assert.ok(get && isSiteAdminContentOk(get));
  assert.equal(get.data.title, normalizeHomeData(raw).title);
  assert.equal(get.sourceVersion.fileSha, "home-sha");

  const post = parseSiteAdminHomePost(
    recordedResponse({ sourceVersion: { fileSha: "home-sha-2" } }),
  );
  assert.ok(post && isSiteAdminContentOk(post));
  assert.equal(post.sourceVersion.fileSha, "home-sha-2");
});

test("content-contract: parses a recorded /calendar-public GET + POST response", async () => {
  const raw = await readContentJson("calendar-public.json");
  const data = normalizePublicCalendarData(raw);
  const get = parseSiteAdminCalendarPublicGet(
    recordedResponse({ data, sourceVersion: { fileSha: "cal-sha" } }),
  );
  assert.ok(get && isSiteAdminContentOk(get));
  assert.equal(get.data.events.length, data.events.length);
  assert.equal(get.sourceVersion.fileSha, "cal-sha");

  const post = parseSiteAdminCalendarPublicPost(
    recordedResponse({ sourceVersion: { fileSha: "cal-sha-2" }, dbStatus: "ok" }),
  );
  assert.ok(post && isSiteAdminContentOk(post));
  assert.equal(post.dbStatus, "ok");
});

test("content-contract: /calendar-public/live reports an empty version before first publish", () => {
  const get = parseSiteAdminCalendarPublicLiveGet(
    recordedResponse({ data: null, sourceVersion: { fileSha: "" } }),
  );
  assert.ok(get && isSiteAdminContentOk(get));
  assert.equal(get.data, null, "null stays null — 'nothing published yet'");
  assert.equal(get.sourceVersion.fileSha, "");

  const post = parseSiteAdminCalendarPublicLivePost(
    recordedResponse({
      eventCount: 12,
      eventsWritten: 12,
      updatedAt: "2026-06-16T19:16:27.532Z",
    }),
  );
  assert.ok(post && isSiteAdminContentOk(post));
  assert.equal(post.eventCount, 12);
});

test("content-contract: surfaces the server error envelope", () => {
  const parsed = parseSiteAdminNowGet({
    ok: false,
    error: "Source changed. Reload latest and try again.",
    code: "SOURCE_CONFLICT",
  });
  assert.ok(parsed);
  assert.equal(isSiteAdminContentOk(parsed), false);
  assert.equal(parsed.ok === false && parsed.code, "SOURCE_CONFLICT");
});

test("content-contract: rejects bodies that are not a valid ack", () => {
  assert.equal(parseSiteAdminNowGet(null), null);
  assert.equal(parseSiteAdminNowGet({ data: {} }), null, "no ok flag");
  // A success ack whose payload lost its version token is unusable: the next
  // write would have no expectedFileSha to send.
  assert.equal(parseSiteAdminNowGet(recordedResponse({ data: {} })), null);
  assert.equal(parseSiteAdminHomeGet(recordedResponse({ sourceVersion: {} })), null);
});

test("content-contract: calendar sha is stable across a normalize round-trip", async () => {
  // The /calendar-public/live conflict check hashes the projection read back
  // out of D1, so normalisation has to be idempotent or every publish 409s.
  const raw = await readContentJson("calendar-public.json");
  const once = normalizePublicCalendarData(raw);
  const twice = normalizePublicCalendarData(JSON.parse(publicCalendarJson(once)));
  const sha = (data) =>
    createHash("sha1").update(publicCalendarJson(data), "utf8").digest("hex");
  assert.equal(sha(twice), sha(once));
});
