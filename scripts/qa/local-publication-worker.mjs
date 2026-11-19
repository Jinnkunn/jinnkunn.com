import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Log, LogLevel, Miniflare } from "miniflare";
import { toContentDocumentPath } from "@jinnkunn/document-repository/path";
import { PUBLICATION_BASELINE_PATH, publicationSearchSnapshot, publicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { STATIC_POLICY_PATH } from "../../lib/shared/static-release.ts";
import { activateVerifiedOverlay, prepareOverlayGeneration, switchOverlayPointer, validateOverlayCandidate } from "../_lib/versioned-overlay.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { assertPackagedReleaseAssets } from "../content/publish-content.mjs";
import { verifyPublicCalendarFeeds } from "../_lib/verify-public-calendar.mjs";

const root = process.cwd();
const origin = "https://staging.publication-fixture.test";
const code = { sha: "a".repeat(40), branch: "main" };
const workerVersionId = "fixture-worker";
const env = "staging";
const localEnv = { ...process.env, SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs", SKIP_SYNC: "0", WRANGLER_SEND_METRICS: "false" };

function run(command, args, env = localEnv) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

function fixture(announcement, text) {
  const baseline = publicationSnapshot({ "filesystem/announcements.json": JSON.stringify({ version: 1, items: [announcement] }) });
  const index = [{ id: "fixture", routePath: "/news", title: text, kind: "page" }];
  const assetPath = `/_next/static/${text.toLowerCase().replace(/[^a-z]+/g, "-")}.js`;
  const rows = [
    ["/__static/index.html", `<h1>${text}</h1><script src="${assetPath}"></script>`, "text/html"],
    ["/__static/news.html", `<h1>${text}</h1>`, "text/html"],
    [assetPath, `/* ${text} */`, "text/javascript"],
    [STATIC_POLICY_PATH, fs.readFileSync(".open-next/assets/__static/protected-routes-policy.json", "utf8"), "application/json"],
    [PUBLICATION_BASELINE_PATH, JSON.stringify({ ...baseline, search: publicationSearchSnapshot(baseline, index) }), "application/json"],
    ["/__static/content-overlay-status.json", JSON.stringify({ ok: true, env, workerCodeSha: code.sha, fileCount: 4,
      snapshotSha: "b".repeat(40), publicationSnapshotSha: baseline.sha, bundledBuild: false }), "application/json"],
  ].map(([asset_path, body, content_type]) => ({ asset_path, body, content_type, updated_at: Date.now(), content_sha: createHash("sha1").update(body).digest("hex") }));
  return { rows, baseline, assetPath, status: validateOverlayCandidate(rows, { env, workerCodeSha: code.sha, publicationSha: baseline.sha }) };
}

async function waitUntil(time) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, time - Date.now() + 30)));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jinnkunn-local-publication-"));
  let worker;
  try {
    if (!process.argv.includes("--skip-build")) run("npm", ["run", "build:cf"]);
    assertPackagedReleaseAssets();
    run(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "versions", "upload", "--env", "staging", "--dry-run", "--outdir", tmp], {
      ...localEnv, WRANGLER_LOG_PATH: path.join(tmp, "wrangler.log"),
    });
    const bindings = {
      SITE_ADMIN_STORAGE: "db", SITE_ADMIN_AUTH_MODE: "legacy", SITE_ADMIN_EMAILS: "editor@example.test",
      NEXTAUTH_SECRET: "local-publication-fixture-not-a-real-secret", NEXTAUTH_URL: origin,
      SITE_WORKER_VERSION: { id: workerVersionId }, STAGING_GATE: "1", STATIC_SHELL_OVERLAY: "1",
    };
    worker = new Miniflare({ modulesRoot: tmp, modules: [{ type: "ESModule", path: path.join(tmp, "worker-entry.js") }], compatibilityDate: "2026-04-22",
      compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port: 0,
      log: new Log(LogLevel.WARN),
      assets: { directory: path.join(root, ".open-next/assets"), binding: "ASSETS", routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
      bindings, d1Databases: { SITE_ADMIN_DB: "local-publication-fixture" }, cf: false,
      outboundService: () => new Response("External network is disabled for local publication QA", { status: 502 }),
    });
    const db = await worker.getD1Database("SITE_ADMIN_DB");
    for (const file of ["001_content_files.sql", "003_calendar_public.sql", "004_static_shell_overlays.sql",
      "007_calendar_observations.sql", "009_release_control_plane.sql", "010_static_shell_overlay_active.sql", "011_calendar_observation_revision.sql",
      "012_calendar_projection_exclusions.sql"]) {
      // D1.exec executes a statement per line; preserve the migration's multi-line DDL.
      for (const sql of fs.readFileSync(path.join(root, "migrations", file), "utf8").replace(/^--.*$/gm, "").split(/;[ \t]*$/m).map((part) => part.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    const query = ({ sql, params = [] }) => db.prepare(sql).bind(...params).all();
    const auth = await createNextAuthSessionCookie({ env: bindings });
    assert.ok(auth.ok);
    const request = (route, authenticated = true, headers = {}, method = "GET") => worker.dispatchFetch(`${origin}${route}`, {
      method, redirect: "manual", headers: { ...(authenticated ? { cookie: auth.cookie } : {}), ...headers },
    });
    const anonymous = await request("/", false);
    assert.equal(anonymous.status, 302, `Anonymous staging request: ${(await anonymous.text()).slice(0, 480)}`);
    assert.match(anonymous.headers.get("location") || "", /\/api\/auth\/signin/);
    assert.equal((await request("/api/site-admin/status", false)).status, 401);
    assert.equal((await request("/__static/index.html")).status, 404);
    assert.equal((await request("/api/site-announcement", false)).status, 401);
    const calendarDate = Date.now();
    const futureAt = (days) => new Date(calendarDate + days * 86_400_000).toISOString();
    const calendarFixture = JSON.stringify({
      generatedAt: futureAt(0),
      range: { startsAt: futureAt(0), endsAt: futureAt(10) },
      events: [1, 8].map((days) => ({
        id: "same-calendar-fixture-series", visibility: "busy", title: "Private fixture",
        description: "Private fixture body", startsAt: futureAt(days),
        endsAt: new Date(Date.parse(futureAt(days)) + 3_600_000).toISOString(),
      })),
    });
    await db.prepare("INSERT INTO content_files (rel_path, body, sha, size, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(toContentDocumentPath("content/calendar-public.json"), calendarFixture, createHash("sha1").update(calendarFixture).digest("hex"),
        Buffer.byteLength(calendarFixture), calendarDate).run();
    await db.prepare("UPDATE calendar_observation_revision SET revision = 42, updated_at = ? WHERE id = 1").bind(futureAt(0)).run();
    const calendar = await verifyPublicCalendarFeeds((path) => request(path), { retryDelays: [0], requireVerifiedAt: true });
    assert.deepEqual(calendar, { revision: 42, events: 2, busy: 2, verifiedAt: futureAt(0) });
    for (const path of ["/api/public/calendar", "/api/public/calendar/calendar.ics"]) {
      const head = await request(path, true, {}, "HEAD");
      assert.equal(head.status, 200, "Calendar feed accepts HEAD for a version-only probe.");
      assert.equal(head.headers.get("x-calendar-revision"), "42");
      assert.equal(head.headers.get("x-calendar-verified-at"), futureAt(0));
      assert.equal(await head.text(), "");
    }
    const start = Date.now() + 2_500, end = start + 2_000;
    const notice = { id: "fixture-notice", title: "Timed update", status: "published", bodyMdx: "Public only during the schedule.",
      startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
    const old = fixture(notice, "Verified live news");
    const previous = await prepareOverlayGeneration({ query, env, git: code, ...old, note: "fixture live" });
    await switchOverlayPointer({ query, env, workerVersionId, expectedId: "", nextId: previous.id });
    async function assertLive(expected) {
      const home = await request("/");
      assert.equal(home.status, 200);
      assert.equal(home.headers.get("x-static-overlay"), "1");
      assert.equal(home.headers.get("x-publication-snapshot"), expected.baseline.sha);
      assert.equal(await home.text(), expected.rows[0].body);
      const asset = await request(expected.assetPath);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), expected.rows.find((row) => row.asset_path === expected.assetPath).body);
      const search = await request("/api/search?q=news");
      assert.equal(search.status, 200);
      assert.equal(search.headers.get("x-publication-snapshot"), expected.baseline.sha);
    }
    assert.equal((await (await request("/api/site-announcement")).json()).announcement, null);
    await assertLive(old);
    const next = fixture({ ...notice, title: "Not live", status: "draft" }, "Candidate content");
    const candidate = await prepareOverlayGeneration({ query, env, git: code, ...next, note: "fixture candidate" });
    await assertLive(old);
    await assert.rejects(activateVerifiedOverlay({ query, env, workerVersionId, candidateId: candidate.id, verify: async () => {
      await assertLive(next);
      throw new Error("Injected verification failure after activation");
    } }), /previous staging overlay was restored/);
    await assertLive(old);
    await waitUntil(start);
    const visible = await (await request("/api/site-announcement")).json();
    assert.equal(visible.announcement.title, "Timed update");
    assert.match(visible.expanded, /Public only during the schedule/);
    await waitUntil(end + 1);
    const expired = await (await request("/api/site-announcement")).json();
    assert.equal(expired.announcement, null);
    assert.equal(expired.refreshAt, null);
    assert.equal((await request("/blog")).status, 404, "A removed shell must not fall back to the bundled blog.");
    assert.notEqual((await request("/teaching/archive/2024-25-fall/csci3141")).status, 200, "The session must not unlock password-protected content.");
    const recordedAt = Date.now();
    const record = (id, version, snapshot, time) => db.prepare(
      "INSERT INTO release_history (id, recorded_at, source, env, deployed_version_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, time, "content-fixture", env, version, JSON.stringify({ publicVerification: { snapshotSha: snapshot } })).run();
    await record("wrong-worker", "older-worker", old.baseline.sha, recordedAt + 3_000);
    await record("wrong-snapshot", workerVersionId, next.baseline.sha, recordedAt + 2_000);
    async function liveReceipt() {
      const result = await request("/api/site-admin/status");
      assert.equal(result.status, 200);
      return (await result.json()).data.livePublication;
    }
    assert.deepEqual(await liveReceipt(), { workerVersionId, snapshotSha: old.baseline.sha, verifiedAt: null });
    await record("verified-pair", workerVersionId, old.baseline.sha, recordedAt);
    assert.deepEqual(await liveReceipt(), { workerVersionId, snapshotSha: old.baseline.sha, verifiedAt: new Date(recordedAt).toISOString() });
    console.log("Local Worker QA passed: real middleware, versioned HTML/assets/search, calendar GET/HEAD, rollback, and timed announcements.");
  } finally {
    await worker?.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
