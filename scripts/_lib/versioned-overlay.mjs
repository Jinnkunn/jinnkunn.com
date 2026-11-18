import { createHash, randomUUID } from "node:crypto";
import { STATIC_POLICY_PATH } from "../../lib/shared/static-release.ts";
import { PUBLICATION_BASELINE_PATH, readPublicationSearch } from "../../lib/shared/publication-snapshot.mjs";
import { validatePublishedSnapshot } from "./publication-snapshot-files.mjs";
import { overlayVerificationTargets } from "./overlay-serving-verification.mjs";

const STATUS_PATH = "/__static/content-overlay-status.json";
const COLUMNS = ["snapshot_id", "asset_path", "body", "content_type", "content_sha", "source_sha", "source_branch", "updated_at"];
const sha1 = (body) => createHash("sha1").update(body).digest("hex");
const rowsOf = (result) => (Array.isArray(result) ? result[0]?.results : result?.results) || [];

export function validateOverlayCandidate(rows, { env, workerCodeSha, publicationSha }) {
  const byPath = new Map(rows.map((row) => [row.asset_path, row]));
  if (byPath.size !== rows.length || rows.some((row) => typeof row.body !== "string" || sha1(row.body) !== row.content_sha)) {
    throw new Error("Release candidate contains duplicate paths or invalid fingerprints.");
  }
  const policy = JSON.parse(byPath.get(STATIC_POLICY_PATH)?.body || "null");
  const baseline = JSON.parse(byPath.get(PUBLICATION_BASELINE_PATH)?.body || "null");
  const status = JSON.parse(byPath.get(STATUS_PATH)?.body || "null");
  if (!Array.isArray(policy?.rules) || !status?.ok || status.env !== env || status.workerCodeSha !== workerCodeSha ||
      status.publicationSnapshotSha !== publicationSha || status.fileCount !== rows.length - 2 ||
      validatePublishedSnapshot(baseline).sha !== publicationSha || readPublicationSearch(baseline).snapshotSha !== publicationSha) {
    throw new Error("Release candidate has mismatched content, search, or protection metadata.");
  }
  overlayVerificationTargets(rows);
  return status;
}

export async function readOverlayPointer(query, env, workerVersionId) {
  const [row] = rowsOf(await query({ env, sql: "SELECT snapshot_id, previous_snapshot_id FROM static_shell_overlay_active WHERE worker_version_id = ?", params: [workerVersionId] }));
  return { id: row?.snapshot_id || "", previousId: row?.previous_snapshot_id || "" };
}

export async function switchOverlayPointer({ query, env, workerVersionId, expectedId, nextId, previousId = expectedId }) {
  const result = await query({ env, sql: `INSERT INTO static_shell_overlay_active (worker_version_id, snapshot_id, previous_snapshot_id, updated_at)
    SELECT ?, ?, ?, ? WHERE COALESCE((SELECT snapshot_id FROM static_shell_overlay_active WHERE worker_version_id = ?), '') = ?
    ON CONFLICT(worker_version_id) DO UPDATE SET snapshot_id = excluded.snapshot_id,
      previous_snapshot_id = excluded.previous_snapshot_id, updated_at = excluded.updated_at`,
  params: [workerVersionId, nextId, previousId || null, Date.now(), workerVersionId, expectedId] });
  const changes = (Array.isArray(result) ? result[0] : result)?.meta?.changes;
  if (changes === 0 || (await readOverlayPointer(query, env, workerVersionId)).id !== nextId) {
    throw new Error("The active publication changed before activation. Prepare and verify a new candidate.");
  }
}

// No public pointer references these rows until every stored body has passed verification.
export async function prepareOverlayGeneration({ query, env, rows, git, status, note }) {
  const id = randomUUID();
  try {
    for (let i = 0; i < rows.length; i += 5) {
      const group = rows.slice(i, i + 5);
      await query({ env, sql: `INSERT INTO static_shell_overlay_versions (${COLUMNS.join(", ")}) VALUES ${group.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        params: group.flatMap((row) => [id, ...COLUMNS.slice(1).map((column) => row[column] ?? null)]) });
      const stored = rowsOf(await query({ env, sql: `SELECT asset_path, body, content_sha, content_type FROM static_shell_overlay_versions WHERE snapshot_id = ? AND asset_path IN (${group.map(() => "?").join(", ")})`,
        params: [id, ...group.map((row) => row.asset_path)] }));
      const byPath = new Map(stored.map((row) => [row.asset_path, row]));
      if (group.some((row) => {
        const copy = byPath.get(row.asset_path);
        return copy?.content_type !== row.content_type || copy.content_sha !== row.content_sha || sha1(copy.body) !== row.content_sha;
      })) throw new Error("Stored overlay candidate failed fingerprint verification.");
    }
    await query({ env, sql: `INSERT INTO static_shell_overlay_snapshots
      (id, env, snapshot_sha, source_sha, source_branch, file_count, created_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, env, status.snapshotSha, git.sha, git.branch, rows.length, Date.now(), note] });
    return { id, fileCount: rows.length, snapshotSha: status.snapshotSha };
  } catch (error) {
    await query({ env, sql: "DELETE FROM static_shell_overlay_versions WHERE snapshot_id = ?", params: [id] }).catch(() => {});
    throw error;
  }
}

export async function activateVerifiedOverlay({ query, env, workerVersionId, candidateId, verify, current }) {
  const previous = current || await readOverlayPointer(query, env, workerVersionId);
  try {
    await switchOverlayPointer({ query, env, workerVersionId, expectedId: previous.id, nextId: candidateId });
    return await verify();
  } catch (error) {
    // Read back the pointer even if the activation response was lost.
    const actual = await readOverlayPointer(query, env, workerVersionId);
    if (actual.id === candidateId) {
      await switchOverlayPointer({ query, env, workerVersionId, expectedId: candidateId, nextId: previous.id, previousId: previous.previousId });
      throw new Error(`Publication failed; the previous ${env} overlay was restored: ${error.message}`, { cause: error });
    }
    throw error;
  }
}
