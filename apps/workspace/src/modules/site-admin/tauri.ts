import { invoke } from "@tauri-apps/api/core";

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

export interface SyncPullParams {
  base_url: string;
  bearer_token?: string;
  session_cookie?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
  batch_limit?: number;
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
  body_text: string | null;
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

export interface OutboxEnqueueParams {
  base_url: string;
  path: string;
  method: string;
  body?: unknown;
}

export function outboxEnqueue(params: OutboxEnqueueParams): Promise<number> {
  return invoke("outbox_enqueue", { params });
}

export interface OutboxStatus {
  pending: number;
  failing: number;
  oldest_enqueued_at: number | null;
}

export function outboxStatus(): Promise<OutboxStatus> {
  return invoke("outbox_status");
}

export interface OutboxEntry {
  id: number;
  base_url: string;
  path: string;
  method: string;
  body_json: string;
  enqueued_at: number;
  attempts: number;
  last_error: string | null;
  last_attempt: number | null;
}

export function outboxList(): Promise<OutboxEntry[]> {
  return invoke("outbox_list");
}

export function outboxRemove(id: number): Promise<void> {
  return invoke("outbox_remove", { id });
}

export interface OutboxDrainAuth {
  bearer_token?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
}

export interface OutboxDrainSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export function outboxDrain(auth: OutboxDrainAuth): Promise<OutboxDrainSummary> {
  return invoke("outbox_drain", { params: { auth } });
}
