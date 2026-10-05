import { createHash } from "node:crypto";

export const PUBLICATION_BASELINE_PATH = "/__admin/publication-baseline.json";

export function isPublicationSource(path) {
  return /^(posts|pages|components)\/.+\.mdx$/.test(path) ||
    /^(home|now|page-tree)\.json$/.test(path) ||
    /^filesystem\/(site-config|announcements|protected-routes)\.json$/.test(path);
}

export function publicationSnapshot(files) {
  const sources = Object.fromEntries(Object.entries(files)
    .filter(([path, body]) => isPublicationSource(path) && typeof body === "string")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return { version: 1, sha: createHash("sha256").update(JSON.stringify(sources)).digest("hex"), sources };
}

export function assertPublicationSnapshot(snapshot, expected) {
  if (expected && snapshot.sha !== expected) {
    throw new Error("PUBLICATION_SNAPSHOT_CHANGED: Saved content changed after review. Review the publication again.");
  }
}

function sourceTitle(path, source) {
  const match = /^title:\s*(.+)$/m.exec(source || "");
  return match ? match[1].replace(/^["']|["']$/g, "") : path;
}

export function publicationReview(current, baseline) {
  const before = baseline.sources;
  const after = current.sources;
  const removed = Object.keys(before).filter((path) => !(path in after));
  const added = Object.keys(after).filter((path) => !(path in before));
  const changes = [];
  const moved = new Set();
  for (const path of added) {
    // Only exact, unambiguous matches are classified as moves.
    const matches = removed.filter((old) => before[old] === after[path]);
    const unique = added.filter((next) => after[next] === after[path]).length === 1;
    const oldPath = matches.length === 1 && unique ? matches[0] : "";
    if (oldPath) moved.add(oldPath);
    changes.push({ path, oldPath, kind: oldPath ? "moved" : "added", title: sourceTitle(path, after[path]), before: oldPath ? before[oldPath] : "", after: after[path] });
  }
  for (const path of Object.keys(before)) {
    if (moved.has(path)) continue;
    if (!(path in after) || before[path] !== after[path]) {
      changes.push({ path, oldPath: "", kind: path in after ? "changed" : "deleted", title: sourceTitle(path, after[path] ?? before[path]), before: before[path], after: after[path] ?? "" });
    }
  }
  return { snapshotSha: current.sha, baselineSha: baseline.sha, changes: changes.sort((a, b) => a.path.localeCompare(b.path)) };
}
