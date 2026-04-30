// Thin TS client over the Phase 5a Tauri commands. Centralizes:
//   - which credentials to thread into sync_pull
//   - error handling + logging shape (so callers don't each invent one)
//   - a hand-off from the existing connection model
//
// Phase 5a scope: read-cache only. Writes still go through siteAdminRequest
// → /api/site-admin/* unchanged. When 5b adds the outbox + push command,
// the additions land here so call sites stay symmetric:
//   localContent.getFile / .listFiles / .syncPull (today)
//   localContent.write / .pushOutbox                (5b)

import {
  localGetFile,
  localListFiles,
  localSyncStatus,
  syncPull,
  type LocalFileEntry,
  type LocalFileRow,
  type LocalSyncStatus,
  type SyncPullParams,
  type SyncPullSummary,
} from "../../modules/site-admin/tauri";

export type {
  LocalFileEntry,
  LocalFileRow,
  LocalSyncStatus,
  SyncPullParams,
  SyncPullSummary,
};

export interface LocalSyncCredentials {
  baseUrl: string;
  authToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface LocalSyncOptions {
  /** Drop the local watermark and re-pull every row. Used by an explicit
   * "Resync from server" button (not yet exposed). */
  resetWatermark?: boolean;
  /** Override per-pull batch size; server caps at 1000. */
  batchLimit?: number;
}

/** Maps the existing credential shape (the same object SiteAdminSurface
 * threads into siteAdminRequest) onto the snake_case the Rust command
 * deserializes from. Trims and drops empties so the Rust side never sees
 * "" for a field that should have been omitted. */
function buildSyncParams(
  credentials: LocalSyncCredentials,
  options: LocalSyncOptions = {},
): SyncPullParams {
  const baseUrl = credentials.baseUrl.trim();
  const params: SyncPullParams = { base_url: baseUrl };
  const token = credentials.authToken.trim();
  if (token) params.bearer_token = token;
  const cid = credentials.cfAccessClientId?.trim() || "";
  const secret = credentials.cfAccessClientSecret?.trim() || "";
  if (cid && secret) {
    params.cf_access_client_id = cid;
    params.cf_access_client_secret = secret;
  }
  if (options.batchLimit && options.batchLimit > 0) {
    params.batch_limit = Math.floor(options.batchLimit);
  }
  if (options.resetWatermark) params.reset_watermark = true;
  return params;
}

export const localContent = {
  /** One-shot pull: drains the server's hasMore loop in one call. Returns
   * a summary the caller can render in a status pill. Throws on network /
   * parse / DB errors so the auto-sync hook can surface them as "stale". */
  async syncPull(
    credentials: LocalSyncCredentials,
    options?: LocalSyncOptions,
  ): Promise<SyncPullSummary> {
    if (!credentials.baseUrl || !credentials.authToken) {
      throw new Error("local sync: missing baseUrl / authToken");
    }
    return syncPull(buildSyncParams(credentials, options));
  },

  async getFile(repoOrContentRel: string): Promise<LocalFileRow | null> {
    return localGetFile(stripContentPrefix(repoOrContentRel));
  },

  async listFiles(
    repoOrContentRel: string,
    opts: { recursive?: boolean } = {},
  ): Promise<LocalFileEntry[]> {
    return localListFiles(
      stripContentPrefix(repoOrContentRel),
      Boolean(opts.recursive),
    );
  },

  async status(): Promise<LocalSyncStatus> {
    return localSyncStatus();
  },
};

/** Accept either repo-rooted (`content/posts/foo.mdx`) or content-rooted
 * (`posts/foo.mdx`) paths. The local mirror stores rows under the
 * content-rooted form (matching D1's content_files.rel_path), so we
 * normalize at the boundary so callers don't have to remember which
 * convention the local cache uses. */
function stripContentPrefix(input: string): string {
  const trimmed = input.replace(/^\/+/, "");
  return trimmed.startsWith("content/") ? trimmed.slice("content/".length) : trimmed;
}
