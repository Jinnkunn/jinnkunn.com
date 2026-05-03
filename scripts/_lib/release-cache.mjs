/**
 * Per-SHA release cache for the Tauri-driven local release path.
 *
 * Markers live under `.cache/release/<bucket>/<SHA>.json`. Each marker
 * answers one question: "did <bucket> already pass for <SHA>, recently
 * enough that re-running it would be wasted work?". The release scripts
 * write a marker after a successful step and read it before deciding to
 * spend time on the same step again.
 *
 * Why per-SHA, not per-tree:
 *   Operators routinely run `release:staging` then `release:prod:from-
 *   staging` against the same `git rev-parse HEAD`. Both go through the
 *   same lint/test/check + verify gates; the second pass is identical
 *   work. Anything we cache here is invalidated naturally by the next
 *   commit (new SHA → no marker), so the cache cannot mask a regression
 *   that landed between releases.
 *
 * TTL guard:
 *   We still cap each marker by wall-clock age. A staging-verify that
 *   passed 2 hours ago is no proof that staging is still healthy now —
 *   maybe a manual edit landed via the workspace UI in between. Per-
 *   bucket TTLs are tuned in the call sites (see CHECKS_TTL_MS,
 *   STAGING_VERIFY_TTL_MS).
 */

import fs from "node:fs";
import path from "node:path";

const SHA_RE = /^[a-f0-9]{7,40}$/i;

function bucketDir(repoRoot, bucket) {
  if (!repoRoot) throw new Error("release-cache: repoRoot is required");
  if (!bucket) throw new Error("release-cache: bucket is required");
  return path.join(repoRoot, ".cache", "release", bucket);
}

function normalizeSha(sha) {
  const raw = String(sha || "").trim().toLowerCase();
  return SHA_RE.test(raw) ? raw : "";
}

function markerPath(repoRoot, bucket, sha) {
  const norm = normalizeSha(sha);
  if (!norm) return "";
  return path.join(bucketDir(repoRoot, bucket), `${norm}.json`);
}

/**
 * Read a marker. Returns the parsed payload (with `_writtenAtMs` injected
 * from mtime) or `null` if the marker is missing, malformed, or older
 * than `maxAgeMs` (when provided).
 */
export function readMarker({ repoRoot, bucket, sha, maxAgeMs }) {
  const file = markerPath(repoRoot, bucket, sha);
  if (!file) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  let writtenAtMs = 0;
  try {
    writtenAtMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (typeof maxAgeMs === "number" && maxAgeMs > 0) {
    const age = Date.now() - writtenAtMs;
    if (age > maxAgeMs) return null;
  }
  return { ...parsed, _writtenAtMs: writtenAtMs };
}

/**
 * Persist a marker. Atomic write via temp-rename so a crash mid-write
 * leaves the previous marker intact rather than a half-written file the
 * next read would silently throw away.
 */
export function writeMarker({ repoRoot, bucket, sha, payload }) {
  const file = markerPath(repoRoot, bucket, sha);
  if (!file) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({ ...payload, sha: normalizeSha(sha) }, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(tmp, file);
  return true;
}

/**
 * Remove a marker. Safe to call when the file doesn't exist.
 */
export function clearMarker({ repoRoot, bucket, sha }) {
  const file = markerPath(repoRoot, bucket, sha);
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}
