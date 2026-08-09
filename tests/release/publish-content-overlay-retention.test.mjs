// P2-32: every content publish copies the whole ~3.5MB static shell overlay
// into static_shell_overlay_versions, and the admin console queues a publish
// on every save. Nothing reclaimed it, so D1 grew without bound.

import test from "node:test";
import assert from "node:assert/strict";

import {
  OVERLAY_SNAPSHOT_RETENTION,
  pruneOverlaySnapshots,
} from "../../scripts/content/publish-content.mjs";

function fakeD1(snapshotIds) {
  const calls = [];
  const query = async ({ env, sql, params = [] }) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    calls.push({ env, params, sql: normalized });
    if (normalized.startsWith("SELECT id FROM static_shell_overlay_snapshots")) {
      // Mirror SQLite's `LIMIT -1 OFFSET ?`: newest first, skip the keepers.
      return [{ results: snapshotIds.slice(params[0]).map((id) => ({ id })) }];
    }
    return [{ results: [] }];
  };
  return { calls, query };
}

test("overlay retention: keeps the newest 10 snapshots by default", () => {
  assert.equal(OVERLAY_SNAPSHOT_RETENTION, 10);
});

test("overlay retention: drops version bodies and snapshot rows together", async () => {
  const ids = Array.from({ length: 13 }, (_, i) => `snap-${13 - i}`);
  const { calls, query } = fakeD1(ids);

  const pruned = await pruneOverlaySnapshots("staging", OVERLAY_SNAPSHOT_RETENTION, query);
  assert.equal(pruned, 3);

  const expired = ["snap-3", "snap-2", "snap-1"];
  const deletes = calls.filter((call) => call.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 2);
  // Bodies first: a snapshot row whose versions are gone is a rollback target
  // that only fails once someone reaches for it.
  assert.match(deletes[0].sql, /DELETE FROM static_shell_overlay_versions WHERE snapshot_id IN/);
  assert.deepEqual(deletes[0].params, expired);
  assert.match(deletes[1].sql, /DELETE FROM static_shell_overlay_snapshots WHERE id IN/);
  assert.deepEqual(deletes[1].params, expired);
  for (const call of calls) assert.equal(call.env, "staging");
});

test("overlay retention: nothing to do below the ceiling", async () => {
  const { calls, query } = fakeD1(["snap-2", "snap-1"]);
  const pruned = await pruneOverlaySnapshots("production", OVERLAY_SNAPSHOT_RETENTION, query);
  assert.equal(pruned, 0);
  assert.ok(!calls.some((call) => call.sql.startsWith("DELETE")));
});

test("overlay retention: chunks deletes to stay inside D1's parameter budget", async () => {
  const ids = Array.from({ length: 75 }, (_, i) => `snap-${75 - i}`);
  const { calls, query } = fakeD1(ids);
  const pruned = await pruneOverlaySnapshots("staging", 10, query);
  assert.equal(pruned, 65);
  const deletes = calls.filter((call) => call.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 8);
  for (const call of deletes) assert.ok(call.params.length <= 20);
});

test("overlay retention: the publish path prunes after every snapshot", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const script = await readFile(
    path.join(process.cwd(), "scripts/content/publish-content.mjs"),
    "utf8",
  );
  const snapshotFn = script.slice(
    script.indexOf("async function snapshotCurrentOverlay"),
    script.indexOf("export const OVERLAY_SNAPSHOT_RETENTION"),
  );
  assert.match(snapshotFn, /await pruneOverlaySnapshots\(env\)/);
});
