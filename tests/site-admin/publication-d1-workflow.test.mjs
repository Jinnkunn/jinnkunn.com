import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createDbDocumentRepository } from "../../lib/server/db-content-store.ts";
import { createD1Executor } from "../../lib/server/d1-executor.ts";
import { DocumentConflictError } from "@jinnkunn/document-repository";
import { createReleaseJob, claimReleaseJob, completeReleaseJob, retryReleaseJob } from "../../lib/server/release-jobs-service.ts";
import { assertDocumentDraftSource } from "../../lib/shared/document-draft-validation.ts";
import { assertPublicationReady } from "../../lib/shared/publication-validation.ts";
import { publicationSnapshot, publicationReview, assertPublicationSnapshot, publicationSearchSnapshot, readPublicationSearch, PUBLICATION_BASELINE_PATH } from "../../lib/shared/publication-snapshot.mjs";
import { verifyOverlayContent } from "../../scripts/_lib/overlay-serving-verification.mjs";

const digest = (value) => createHash("sha1").update(value).digest("hex");
function isolatedD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["001_content_files.sql", "002_content_files_history.sql", "004_static_shell_overlays.sql"]) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
  const binding = { prepare(sql) {
    const query = (args = []) => ({ async all() {
      const statement = db.prepare(sql), values = args.map((arg) => arg instanceof ArrayBuffer ? Buffer.from(arg) : arg);
      if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
    } });
    return { ...query(), bind: (...args) => query(args) };
  } };
  return { db, executor: createD1Executor(binding) };
}

test("isolated D1: save, CAS conflict, snapshot validation, failed runner retry, HTML/search publication and cleanup", async () => {
  const { db, executor } = isolatedD1();
  const repo = createDbDocumentRepository({ executor, getActor: () => "isolated-qa" });
  const path = "posts/qa-test.mdx", routePath = "/blog/qa-test";
  const baseline = publicationSnapshot({});
  const snapshot = () => publicationSnapshot(Object.fromEntries(db.prepare("SELECT rel_path, body FROM content_files").all().map((row) => [row.rel_path, Buffer.from(row.body).toString("utf8")])));
  const save = async (source, version) => { assertDocumentDraftSource(source, "posts"); return repo.writeText(path, source, { expectedVersion: version }); };
  try {
    const incomplete = '---\ntitle: ""\ndate: ""\ndraft: true\n---\n';
    const created = await save(incomplete, null);
    assert.equal((await repo.readText(path)).content, incomplete);
    assert.equal(assertPublicationReady(snapshot()).warnings.length, 3);
    const publicIncomplete = incomplete.replace("draft: true", "draft: false");
    const changed = await save(publicIncomplete, created.version);
    assert.throws(() => assertPublicationReady(snapshot()), /PUBLICATION_VALIDATION_FAILED/);
    assert.equal(db.prepare("SELECT count(*) AS count FROM static_shell_overlays").get().count, 0);
    const source = '---\ntitle: D1 publication proof\ndate: 2026-10-25\ndraft: false\n---\nVerified body marker.';
    const saved = await save(source, changed.version);
    await assert.rejects(save("Stale client overwrite", created.version), DocumentConflictError);
    assert.equal((await repo.readText(path)).content, source);
    const reviewed = snapshot();
    assertPublicationReady(reviewed);
    const review = publicationReview(reviewed, baseline);
    assert.equal(review.changes[0].path, path);
    const job = await createReleaseJob({ action: "publish-content-staging", actor: "isolated-qa", request: { reviewSnapshotSha: reviewed.sha }, executor });
    assert.equal(job.ok, true);
    const claimed = await claimReleaseJob({ agentId: "isolated-runner", preferredJobId: job.data.id, executor });
    assert.equal(claimed.data.job.status, "running");
    await completeReleaseJob({ id: job.data.id, status: "failed", error: "Injected build failure before overlay mutation", executor });
    assert.equal(db.prepare("SELECT count(*) AS count FROM static_shell_overlays").get().count, 0);
    const retry = await retryReleaseJob({ id: job.data.id, actor: "isolated-qa", executor });
    assert.equal(retry.ok, true); assert.equal(retry.data.request.reviewSnapshotSha, reviewed.sha);
    await claimReleaseJob({ agentId: "isolated-runner", preferredJobId: retry.data.id, executor });
    assertPublicationSnapshot(snapshot(), retry.data.request.reviewSnapshotSha);
    const html = "<!doctype html><h1>D1 publication proof</h1><p>Verified body marker.</p>";
    const search = publicationSearchSnapshot(reviewed, [{ id: "qa-test", title: "D1 publication proof", kind: "post", routePath }]);
    const rows = [
      { asset_path: "/__static/index.html", body: "<!doctype html><h1>Home unchanged</h1>" },
      { asset_path: `/__static${routePath}.html`, body: html },
      { asset_path: PUBLICATION_BASELINE_PATH, body: JSON.stringify({ ...reviewed, search }) },
    ];
    db.exec("BEGIN");
    for (const row of rows) db.prepare("INSERT INTO static_shell_overlays (asset_path, body, content_sha, updated_at) VALUES (?, ?, ?, ?)").run(row.asset_path, row.body, digest(row.body), Date.now());
    db.exec("COMMIT");
    // A SQLite-backed HTTP boundary, not a hand-written API response fixture.
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname, asset = pathname === "/" ? "/__static/index.html" : `/__static${pathname}.html`;
      const row = db.prepare("SELECT * FROM static_shell_overlays WHERE asset_path = ?").get(asset);
      return new Response(row?.body ?? "Not found", { status: row ? 200 : 404, headers: row ? { "x-static-shell": "1", "x-static-overlay": "1", "x-static-shell-path": asset, etag: `"${row.content_sha}"` } : {} });
    };
    assert.equal((await verifyOverlayContent({ origin: "https://isolated.test", rows, fetchImpl, attempts: 1 })).ok, true);
    const published = JSON.parse(db.prepare("SELECT body FROM static_shell_overlays WHERE asset_path = ?").get(PUBLICATION_BASELINE_PATH).body);
    assert.equal(readPublicationSearch(published).index[0].routePath, routePath);
    assert.equal(publicationReview(snapshot(), published).changes.length, 0);
    const done = await completeReleaseJob({ id: retry.data.id, status: "succeeded", result: { snapshotSha: reviewed.sha }, executor });
    assert.equal(done.data.status, "succeeded");
    await repo.delete(path, { expectedVersion: saved.version });
    assert.equal(await repo.readText(path), null);
    assert.equal(publicationReview(snapshot(), published).changes[0].kind, "deleted");
    assert.throws(() => assertPublicationSnapshot(snapshot(), reviewed.sha), /PUBLICATION_SNAPSHOT_CHANGED/);
    const cleaned = snapshot();
    assertPublicationReady(cleaned);
    db.prepare("DELETE FROM static_shell_overlays WHERE asset_path = ?").run(`/__static${routePath}.html`);
    db.prepare("UPDATE static_shell_overlays SET body = ? WHERE asset_path = ?").run(JSON.stringify({ ...cleaned, search: publicationSearchSnapshot(cleaned, []) }), PUBLICATION_BASELINE_PATH);
    assert.equal((await fetchImpl(`https://isolated.test${routePath}`)).status, 404);
    const afterCleanup = JSON.parse(db.prepare("SELECT body FROM static_shell_overlays WHERE asset_path = ?").get(PUBLICATION_BASELINE_PATH).body);
    assert.deepEqual(readPublicationSearch(afterCleanup).index, []);
    assert.equal(publicationReview(cleaned, afterCleanup).changes.length, 0);
    assert.ok((await repo.listHistory(path)).length >= 3);
  } finally { db.close(); }
});
