// Powers the Tauri local-cache sync flow (Phase 5a). Reads content_files
// rows updated after the caller's watermark and returns them as a JSON
// batch. Body bytes are hex-encoded so the JSON envelope stays text-clean
// — same trick scripts/dump-content-from-db.mjs uses.
//
// Only the *db* SITE_ADMIN_STORAGE backend exposes a meaningful
// implementation. Local mode returns ok=false so the Tauri client knows
// there's nothing to mirror locally.
//
// No `server-only` marker so node:test can import this module directly.

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import type { DbExecutor } from "./db-content-store.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export type SyncPullRow = {
  relPath: string;
  bodyHex: string;
  isBinary: boolean;
  sha: string;
  size: number;
  updatedAt: number;
  updatedBy: string | null;
};

export type SyncPullResult = {
  ok: true;
  rows: SyncPullRow[];
  // Highest `updated_at` in the returned batch, or the caller's `since`
  // when the batch is empty. Clients persist this and pass it back as
  // `since` next time to fetch only the delta.
  nextSince: number;
  // True when the row count hit `limit` — caller should immediately
  // pull again with `since=nextSince` to drain the remainder.
  hasMore: boolean;
} | {
  ok: false;
  error: string;
  code: "DB_BACKEND_UNAVAILABLE";
};

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryGetD1Executor(): DbExecutor | null {
  // Mirrors content-store-resolver.tryGetD1Executor — if there's no
  // request-time CF binding (build, scripts, tests) we report the
  // backend as unavailable instead of crashing.
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    return isD1Like(binding) ? createD1Executor(binding) : null;
  } catch {
    return null;
  }
}

function clampLimit(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw ?? DEFAULT_LIMIT));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function clampSince(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw ?? 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Read a batch of rows from the configured D1 binding and return them in
 * the wire format the Tauri sync engine expects. Caller-injected executor
 * is for unit tests; production passes `undefined` so we look up the CF
 * binding at request time.
 */
export async function pullSyncBatch(input: {
  since: number | null | undefined;
  limit: number | null | undefined;
  executor?: DbExecutor;
}): Promise<SyncPullResult> {
  const executor = input.executor ?? tryGetD1Executor();
  if (!executor) {
    return {
      ok: false,
      error:
        "Sync requires SITE_ADMIN_STORAGE=db with a SITE_ADMIN_DB binding configured.",
      code: "DB_BACKEND_UNAVAILABLE",
    };
  }
  const since = clampSince(input.since);
  const limit = clampLimit(input.limit);

  // Order by (updated_at, rel_path) so a stable secondary key breaks
  // ties — without this, two rows with the same updated_at could shift
  // pages and cause the Tauri client to skip or double-fetch.
  // Body comes back as hex so JSON marshalling is safe; the same trick
  // dump-content-from-db.mjs and DbContentStore.getRow already use.
  const result = await executor.execute({
    sql: `SELECT rel_path,
                 lower(hex(body)) AS body_hex,
                 is_binary,
                 sha,
                 size,
                 updated_at,
                 updated_by
            FROM content_files
           WHERE updated_at > ?
           ORDER BY updated_at ASC, rel_path ASC
           LIMIT ?`,
    args: [since, limit + 1],
  });

  const overflowed = result.rows.length > limit;
  const trimmed = overflowed ? result.rows.slice(0, limit) : result.rows;

  const rows: SyncPullRow[] = trimmed.map((row) => ({
    relPath: String(row.rel_path),
    bodyHex: String(row.body_hex || ""),
    isBinary: Number(row.is_binary) === 1,
    sha: String(row.sha),
    size: Number(row.size) || 0,
    updatedAt: Number(row.updated_at) || 0,
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  }));

  const lastUpdatedAt =
    rows.length > 0 ? rows[rows.length - 1].updatedAt : since;

  return {
    ok: true,
    rows,
    nextSince: lastUpdatedAt,
    hasMore: overflowed,
  };
}
