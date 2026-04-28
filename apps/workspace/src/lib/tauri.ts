import { invoke } from "@tauri-apps/api/core";

// Thin typed wrappers around `invoke` so callers don't stringly-type
// command names and payload shapes. Each command in src-tauri/src/main.rs
// has a mirror here.

/** Outbound HTTP call proxied through the Tauri backend so we don't hit
 * CORS from the webview. */
export interface SiteAdminHttpRequest {
  base_url: string;
  path: string;
  method: string;
  body?: unknown;
  session_cookie?: string;
  bearer_token?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
}

export interface SiteAdminHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export function siteAdminHttpRequest(
  request: SiteAdminHttpRequest,
): Promise<SiteAdminHttpResponse> {
  return invoke("site_admin_http_request", { request });
}

/** Site-admin browser login flow. Opens the system browser, listens on a
 * loopback port, returns the authorized token. */
export interface SiteAdminBrowserLoginResult {
  token: string;
  login: string;
  expires_at: string;
}

export function siteAdminBrowserLogin(
  base_url: string,
): Promise<SiteAdminBrowserLoginResult> {
  return invoke("site_admin_browser_login", { baseUrl: base_url });
}

/** Macos traffic-light inset tuner (no-op on other platforms). Dev helper
 * for finding the exact (x, y) that visually centers the lights inside
 * the sidebar header. */
export function debugSetTrafficLights(x: number, y: number): Promise<void> {
  return invoke("debug_set_traffic_lights", { x, y });
}

/** Raw keyring access — prefer `createNamespacedSecureStorage` in
 * lib/secureStorage.ts so feature modules don't collide on key names. */
export function secureStoreSet(key: string, value: string): Promise<void> {
  return invoke("secure_store_set", { key, value });
}

export function secureStoreGet(key: string): Promise<string | null> {
  return invoke("secure_store_get", { key });
}

export function secureStoreDelete(key: string): Promise<void> {
  return invoke("secure_store_delete", { key });
}

// ---------------------------------------------------------------------------
// Phase 5a — local SQLite mirror of D1 content_files. The Rust side opens
// a per-call connection to ~/Library/Application Support/...workspace.db
// and serves these commands without any network unless `sync_pull` is
// invoked. See src-tauri/src/sync.rs for the implementation.
// ---------------------------------------------------------------------------

export interface SyncPullParams {
  base_url: string;
  bearer_token?: string;
  session_cookie?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
  /** Override per-pull batch size; server clamps to 1000. */
  batch_limit?: number;
  /** Force a full resync, ignoring the local watermark. */
  reset_watermark?: boolean;
}

export interface SyncPullSummary {
  rows_applied: number;
  iterations: number;
  last_since: number;
  finished_at_ms: number;
}

export function syncPull(params: SyncPullParams): Promise<SyncPullSummary> {
  return invoke("sync_pull", { params });
}

export interface LocalFileRow {
  rel_path: string;
  is_binary: boolean;
  sha: string;
  size: number;
  updated_at: number;
  updated_by: string | null;
  /** UTF-8-decoded body when is_binary=false, else null. */
  body_text: string | null;
  /** Lowercase hex of the raw body. Always present. */
  body_hex: string;
}

export function localGetFile(relPath: string): Promise<LocalFileRow | null> {
  return invoke("local_get_file", { relPath });
}

export interface LocalFileEntry {
  rel_path: string;
  sha: string;
  size: number;
  updated_at: number;
}

export function localListFiles(
  prefix: string,
  recursive: boolean,
): Promise<LocalFileEntry[]> {
  return invoke("local_list_files", { prefix, recursive });
}

export interface LocalSyncStatus {
  last_sync_since: number;
  last_sync_at_ms: number;
  row_count: number;
}

export function localSyncStatus(): Promise<LocalSyncStatus> {
  return invoke("local_sync_status");
}
