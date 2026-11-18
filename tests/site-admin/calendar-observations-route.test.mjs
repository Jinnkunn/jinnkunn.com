import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { createClient } from "@libsql/client";
import { issueSiteAdminAppToken } from "../../lib/server/site-admin-app-token.ts";
import { registerServerModuleHooks } from "../helpers/server-module-hooks.mjs";

test("calendar observations route uses a calendar-specific body limit", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /CALENDAR_OBSERVATION_SYNC_MAX_BYTES = 4 \* 1024 \* 1024/);
  assert.match(source, /maxBytes: CALENDAR_OBSERVATION_SYNC_MAX_BYTES/);
});

test("calendar observations route exposes authenticated collector-scoped cleanup", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function DELETE\(req: NextRequest\)/);
  assert.match(source, /withSiteAdminContext\([\s\S]*parseCalendarCollectorCleanupCommand/);
  assert.match(source, /cleanupCalendarCollectorObservations\(parsed\.value, databases\.staging\)/);
  assert.match(source, /CALENDAR_OBSERVATION_CLEANUP_MAX_BYTES = 4 \* 1024/);
  assert.match(source, /calendar\.observations\.cleanup/);
  assert.match(source, /publishLiveAfterObservationMutation\([\s\S]*"cleanup"/);
});

test("calendar observations route mirrors successful syncs to Live", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /publishCalendarObservationsToLive/);
  assert.match(source, /publishLiveAfterObservationMutation\([\s\S]*"sync"/);
  assert.match(source, /LIVE_DB_WRITE_FAILED/);
  assert.match(source, /livePublish:/);
});

test("calendar observation mutations do not report success without Live", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  for (const method of ["POST", "DELETE"]) {
    const handler = source.split(`export async function ${method}`)[1].split("export async function")[0];
    assert.match(handler, /if \(!databases\) return calendarWriteUnavailable\(\);\s*const result = await/);
    assert.match(handler, /if \(!livePublish\.ok \|\| livePublish\.skipped\)\s*{\s*return calendarPublishPending/);
  }
  assert.match(source, /status: 503,\s*code: "LIVE_DB_NOT_CONFIGURED"/);
  assert.match(source, /status: 502,\s*code: "LIVE_DB_WRITE_FAILED",\s*extras: { stagingSaved: true/);
});

test("calendar receipts and revision-pinned retries require authentication and do not upload observations", async (t) => {
  registerServerModuleHooks();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(
        specifier === "next/server" || specifier === "next/cache" ? specifier + ".js" : specifier,
        context,
      );
    },
  });
  const { NextRequest } = await import("next/server");
  const observations = await import("../../app/api/site-admin/calendar-observations/route.ts");
  const publish = await import("../../app/api/site-admin/calendar-observations/publish-live/route.ts");
  const keys = {
    SITE_ADMIN_AUTH_MODE: "legacy",
    SITE_ADMIN_EMAILS: "calendar-fixture@example.test",
    SITE_ADMIN_APP_TOKEN_SECRET: "local-fixture-secret-only",
    CLOUDFLARE_API_TOKEN: "isolated-fixture",
    CLOUDFLARE_ACCOUNT_ID: "isolated-fixture",
    SITE_ADMIN_AUDIT_D1_DATABASE_ID: "isolated-fixture",
  };
  for (const [key, value] of Object.entries(keys)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  // The audit sink is stubbed; no test request may reach a remote database.
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));

  const asD1 = (result) => ({
    results: result.rows, meta: { changes: result.rowsAffected }, success: true,
  });
  async function isolatedBinding() {
    const client = createClient({ url: ":memory:" });
    t.after(() => client.close());
    for (const name of ["007_calendar_observations.sql", "011_calendar_observation_revision.sql"]) {
      await client.executeMultiple(await readFile(new URL("../../migrations/" + name, import.meta.url), "utf8"));
    }
    const prepare = (sql, args = []) => ({
      sql,
      args,
      bind: (...values) => prepare(sql, values),
      all: async () => asD1(await client.execute({ sql, args })),
    });
    return {
      client,
      binding: { prepare, batch: async (statements) => (await client.batch(statements)).map(asD1) },
    };
  }
  const staging = await isolatedBinding();
  const live = await isolatedBinding();
  const context = Symbol.for("__cloudflare-context__");
  const previousContext = globalThis[context];
  globalThis[context] = {
    env: { SITE_ADMIN_DB: staging.binding, SITE_ADMIN_DB_LIVE: live.binding },
  };
  t.after(() => {
    if (previousContext === undefined) delete globalThis[context];
    else globalThis[context] = previousContext;
  });
  const token = issueSiteAdminAppToken(keys.SITE_ADMIN_EMAILS, { environment: "staging" }).token;
  const request = (suffix, method = "GET", authorized = true) => new NextRequest(
    "https://staging.example.test/api/site-admin/calendar-observations" + suffix,
    { method, headers: authorized ? { authorization: "Bearer " + token } : {} },
  );
  const collector = "electron-macos:fixture";
  const read = (authorized = true) => observations.GET(
    request("?view=publication&collectorId=" + collector, "GET", authorized),
  );
  const retry = (revision, authorized = true) => publish.POST(
    request("/publish-live?revision=" + revision, "POST", authorized),
  );
  assert.equal((await read(false)).status, 401);
  assert.equal((await retry(8, false)).status, 401);
  assert.equal((await observations.GET(request("?view=publication&collectorId=%3C"))).status, 400);
  assert.equal((await retry("1e2")).status, 400);

  const synced = "2026-11-18T18:45:04.000Z";
  await staging.client.batch([
    { sql: "UPDATE calendar_observation_revision SET revision = 8, updated_at = ? WHERE id = 1", args: [synced] },
    {
      sql: `INSERT INTO calendar_sync_state (id, collector_id, source_id, sync_mode,
              range_starts_at, range_ends_at, event_count, synced_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [collector + ":fixture", collector, "fixture", "replace_range", synced, synced, 0, synced, 8],
    },
  ]);
  const pending = await read();
  assert.equal(pending.headers.get("cache-control"), "no-store");
  assert.deepEqual(await pending.json(), { ok: true, data: { publication: {
    staging: { revision: 8, updatedAt: synced, collectorSyncedAt: synced },
    live: { revision: 0, updatedAt: null, collectorSyncedAt: null },
  } } });
  const stale = await retry(7);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "CALENDAR_REVISION_CHANGED");
  assert.equal((await (await read()).json()).data.publication.live.revision, 0);

  assert.equal((await retry(8)).status, 200);
  const { data: { publication } } = await (await read()).json();
  assert.equal(publication.staging.collectorSyncedAt, synced);
  assert.equal(publication.live.collectorSyncedAt, synced);
  assert.equal(publication.live.revision, 8);
  assert.ok(publication.live.updatedAt);
});
