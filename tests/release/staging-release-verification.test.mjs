import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";
import { materializePublicationSnapshot, readPublicationSnapshot } from "../../scripts/_lib/publication-snapshot-files.mjs";
import { writeMarker } from "../../scripts/_lib/release-cache.mjs";
import { stagingReleaseIdentity, verifyStagingRelease } from "../../scripts/_lib/staging-release-verification.mjs";

const worker = { versionId: "worker-v2", deploymentId: "deployment-v2", workerCodeSha: "a".repeat(40), meta: { contentSha: "b".repeat(40) } };
const overlay = {
  publication_sha: "c".repeat(64), baseline_row_sha: "e".repeat(40), status_sha: "f".repeat(40),
  status: { ok: true, env: "staging", workerCodeSha: worker.workerCodeSha,
    snapshotSha: "d".repeat(40), publicationSnapshotSha: "c".repeat(64) },
};
const checks = ["verify:cf:staging", "verify:staging:authenticated", "verify:calendar:staging", "check:staging-visual"];

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "staging-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("staging build reproduces the published sources, including deletions, without reading drafts", (t) => {
  const root = temporaryRoot(t);
  fs.mkdirSync(path.join(root, "content/posts"), { recursive: true });
  fs.writeFileSync(path.join(root, "content/home.json"), '{"title":"Git home"}');
  fs.writeFileSync(path.join(root, "content/posts/removed.mdx"), "Deleted from the published site");
  const baseline = publicationSnapshot({ "home.json": '{"title":"Published home"}', "posts/d1-only.mdx": "Published in staging" });
  assert.throws(() => materializePublicationSnapshot(root, { ...baseline, sha: "bad" }), /checksum mismatch/);
  assert.throws(() => materializePublicationSnapshot(root, publicationSnapshot({ "pages/../../outside.mdx": "no" })), /Invalid path/);
  materializePublicationSnapshot(root, baseline);
  assert.deepEqual(readPublicationSnapshot(root), baseline);
  assert.ok(!fs.existsSync(path.join(root, "content/posts/removed.mdx")));
});

test("staging acceptance rejects another environment or mismatched baseline", () => {
  assert.throws(() => stagingReleaseIdentity(worker, null), /no matching/);
  assert.throws(() => stagingReleaseIdentity(worker, { ...overlay, status: { ...overlay.status, env: "production" } }), /no matching/);
  assert.throws(() => stagingReleaseIdentity(worker, { ...overlay, publication_sha: "e".repeat(64) }), /no matching/);
});

test("only full checks for the exact active deployment and overlay can be reused", async (t) => {
  const root = temporaryRoot(t);
  let identity = stagingReleaseIdentity(worker, overlay);
  const runs = [];
  const verify = (options = {}) => verifyStagingRelease({
    root, expected: { codeSha: identity.codeSha }, runCheck: (check) => runs.push(check),
    readIdentity: async () => identity, ...options,
  });
  writeMarker({ repoRoot: root, bucket: "staging-verified", sha: worker.workerCodeSha, payload: { verifyScript: checks[0] } });
  assert.equal((await verify()).cached, false);
  assert.deepEqual(runs.splice(0), checks);
  assert.equal((await verify()).cached, true);
  assert.deepEqual(runs, []);
  for (const field of ["versionId", "deploymentId", "artifactSha", "overlaySha", "publicationSha", "baselineRowSha"]) {
    identity = { ...identity, [field]: `changed-${field}` };
    assert.equal((await verify()).cached, false, field);
    assert.deepEqual(runs.splice(0), checks);
  }
  assert.equal((await verify({ force: true })).cached, false);
  assert.deepEqual(runs, checks);
});

test("skipped or failed checks and concurrent publication changes do not mint acceptance", async (t) => {
  const root = temporaryRoot(t);
  const identity = stagingReleaseIdentity(worker, overlay);
  let observed = identity;
  const verify = (options = {}) => verifyStagingRelease({
    root, expected: { codeSha: identity.codeSha }, runCheck: () => {},
    readIdentity: async () => observed, ...options,
  });
  assert.deepEqual((await verify({ skipVisual: true })).checks, checks.filter((check) => check !== "check:staging-visual"));
  await assert.rejects(verify({ runCheck(check) { if (check === "verify:calendar:staging") throw new Error("failed calendar check"); } }), /failed calendar/);
  await assert.rejects(verify({ runCheck() { observed = { ...identity, overlaySha: "new overlay" }; } }), /changed during/);
  observed = identity;
  assert.equal((await verify()).cached, false);
  assert.equal((await verify()).cached, true);
  await assert.rejects(verify({ force: true, runCheck() { throw new Error("check regressed"); } }), /check regressed/);
  assert.equal((await verify()).cached, false);
});
