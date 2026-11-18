import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { publicationSnapshot, PUBLICATION_BASELINE_PATH, publicationSearchSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { activeOverlayTable, STATIC_POLICY_PATH } from "../../lib/shared/static-release.ts";
import { activateVerifiedOverlay, prepareOverlayGeneration, readOverlayPointer, switchOverlayPointer, validateOverlayCandidate } from "../../scripts/_lib/versioned-overlay.mjs";

const code = { sha: "a".repeat(40), branch: "main" };
const env = "production";
function fixture(marker) {
  const baseline = publicationSnapshot({ "components/news.mdx": marker });
  const rows = [
    ["/__static/index.html", `<p>${marker}</p>`], ["/_next/static/app.js", `/* ${marker} */`],
    [STATIC_POLICY_PATH, JSON.stringify({ rules: [] })],
    [PUBLICATION_BASELINE_PATH, JSON.stringify({ ...baseline, search: publicationSearchSnapshot(baseline, []) })],
    ["/__static/content-overlay-status.json", JSON.stringify({ ok: true, env, workerCodeSha: code.sha, fileCount: 3, publicationSnapshotSha: baseline.sha, snapshotSha: "b".repeat(40) })],
  ].map(([asset_path, body]) => ({ asset_path, body, content_type: asset_path.endsWith(".html") ? "text/html" : "text/plain", content_sha: createHash("sha1").update(body).digest("hex"), updated_at: 1 }));
  return { rows, baseline, status: validateOverlayCandidate(rows, { env, workerCodeSha: code.sha, publicationSha: baseline.sha }) };
}

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const file of ["004_static_shell_overlays.sql", "010_static_shell_overlay_active.sql"]) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
  return {
    db,
    query: async ({ sql, params = [] }) => {
      const statement = db.prepare(sql);
      return statement.columns().length ? [{ results: statement.all(...params) }] : [{ meta: statement.run(...params) }];
    },
    body: (key, path) => db.prepare(`SELECT body FROM ${activeOverlayTable(key)} WHERE asset_path = ?`).get(path)?.body,
  };
}

test("prepare/activate keeps each Worker and its published HTML, policy and search together", async (t) => {
  const { query, body } = database(t);
  const old = fixture("original live news");
  const previous = await prepareOverlayGeneration({ query, env, git: code, ...old, note: "current" });
  await switchOverlayPointer({ query, env, workerVersionId: "old-worker", expectedId: "", nextId: previous.id });
  const savedDraft = publicationSnapshot({ "components/news.mdx": "a private saved rewrite" });
  // A code rebuild uses only the published source read from the active pair.
  const pinned = JSON.parse(body("old-worker", PUBLICATION_BASELINE_PATH));
  assert.notEqual(pinned.sha, savedDraft.sha);
  const newCode = fixture(pinned.sources["components/news.mdx"]);
  const candidate = await prepareOverlayGeneration({ query, env, git: code, ...newCode, note: "code candidate" });
  assert.equal(body("new-worker", "/__static/index.html"), undefined);
  assert.equal(body("old-worker", "/__static/index.html"), "<p>original live news</p>");
  await switchOverlayPointer({ query, env, workerVersionId: "new-worker", expectedId: "", nextId: candidate.id });
  assert.equal(JSON.parse(body("new-worker", PUBLICATION_BASELINE_PATH)).search.snapshotSha, pinned.sha);
  assert.equal(body("new-worker", "/_next/static/app.js"), "/* original live news */");
  assert.equal(body("new-worker", STATIC_POLICY_PATH), body("old-worker", STATIC_POLICY_PATH));
  assert.equal((await readOverlayPointer(query, env, "old-worker")).id, previous.id);
  await assert.rejects(switchOverlayPointer({ query, env, workerVersionId: "new-worker", expectedId: "stale", nextId: previous.id }), /changed before activation/);
  assert.equal((await readOverlayPointer(query, env, "new-worker")).id, candidate.id);
});

test("an interrupted prepare or failed serving proof leaves the previous valid pair", async (t) => {
  const { query, db, body } = database(t);
  const old = await prepareOverlayGeneration({ query, env, git: code, ...fixture("old"), note: "current" });
  await switchOverlayPointer({ query, env, workerVersionId: "worker", expectedId: "", nextId: old.id });
  const next = fixture("new");
  await assert.rejects(prepareOverlayGeneration({ env, git: code, ...next, note: "incomplete", query: async (args) => {
    if (args.sql.startsWith("SELECT asset_path, body")) return [{ results: [] }];
    return query(args);
  } }), /failed fingerprint verification/);
  assert.equal(db.prepare("SELECT count(DISTINCT snapshot_id) AS n FROM static_shell_overlay_versions").get().n, 1);
  assert.equal(body("worker", "/__static/index.html"), "<p>old</p>");
  const candidate = await prepareOverlayGeneration({ query, env, git: code, ...next, note: "prepared" });
  await assert.rejects(activateVerifiedOverlay({ query, env, workerVersionId: "worker", candidateId: candidate.id, verify: async () => {
    assert.equal(body("worker", "/__static/index.html"), "<p>new</p>");
    assert.equal(JSON.parse(body("worker", PUBLICATION_BASELINE_PATH)).sha, next.baseline.sha);
    throw new Error("Injected failure checking the served assets");
  } }), /previous production overlay was restored/);
  assert.equal(body("worker", "/__static/index.html"), "<p>old</p>");
  assert.equal((await readOverlayPointer(query, env, "worker")).id, old.id);
});
