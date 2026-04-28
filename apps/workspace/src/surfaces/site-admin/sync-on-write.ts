// Phase 5a — fire-and-forget hook from the central `request()` helper.
// When the user saves something through /api/site-admin/*, the local
// SQLite mirror would otherwise stay stale until the next 30s
// useLocalSync tick. That window is the difference between
//   "save → reopen the same file → see your edits"  (good)
//   "save → reopen the same file → see the *previous* version"  (bad,
//      because the editor migration in MdxDocumentEditor reads from
//      the local mirror first).
//
// So after every successful mutating response on a path we know writes
// to D1's content_files table, we kick off a syncPull immediately.
// Fire-and-forget — the request() return path is unchanged.
//
// We deliberately bypass useLocalSync's in-flight guard here. Two
// concurrent syncs are harmless: the Rust upsert is INSERT OR REPLACE
// keyed on rel_path, both will write the same row, and the watermark
// advances to the same value. Cost is one extra HTTP roundtrip in the
// rare overlap case.

import { localContent, type LocalSyncCredentials } from "./local-content";

// Endpoint prefixes where a successful POST/PUT/DELETE writes rows to
// D1's content_files table. Paths NOT listed here (deploy, preview,
// og-fetch, assets-to-R2, ...) don't trigger a sync.
//
// Allowlist beats denylist: a new endpoint that writes to D1 should
// fail-safe to "no immediate sync, just wait for the next 30s tick"
// rather than fail-unsafe to "trigger sync after every random POST".
const D1_WRITE_PATH_PREFIXES = [
  "/api/site-admin/posts",
  "/api/site-admin/pages",
  "/api/site-admin/config",
  "/api/site-admin/routes",
  "/api/site-admin/protected",
  "/api/site-admin/redirects",
  "/api/site-admin/components",
  "/api/site-admin/home",
  "/api/site-admin/news",
  "/api/site-admin/teaching",
  "/api/site-admin/works",
  "/api/site-admin/publications",
  "/api/site-admin/versions", // restore-from-history also writes a new row
] as const;

function targetsD1Write(path: string): boolean {
  return D1_WRITE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Trigger a background sync if the response was a successful mutating
 * write to a D1-backed endpoint. Resolves immediately (does not await
 * the sync). Errors are swallowed — the SyncStatusPill picks up the
 * stale state on the next interval tick and surfaces the actual error
 * if anything is structurally wrong. */
export function maybeSyncAfterWrite(input: {
  ok: boolean;
  method: string;
  path: string;
  credentials: LocalSyncCredentials | null;
}): void {
  if (!input.ok) return;
  const method = input.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  if (!targetsD1Write(input.path)) return;
  if (!input.credentials || !input.credentials.baseUrl || !input.credentials.authToken) return;
  // Fire and forget. Caught + swallowed so an unhandled rejection
  // doesn't surface as a global error in the React tree.
  void localContent.syncPull(input.credentials).catch(() => {
    // Errors here are visible in the SyncStatusPill on the next interval
    // tick (it sets `error` on failure). No need to surface here too.
  });
}
