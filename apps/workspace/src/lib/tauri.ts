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
 * the workspace titlebar. */
export function debugSetTrafficLights(x: number, y: number): Promise<void> {
  return invoke("debug_set_traffic_lights", { x, y });
}

/** Open an http(s) URL in the user's default browser. The Tauri webview
 * doesn't honour `<a target="_blank">` on its own; this routes through
 * the Rust `open` crate so external links land in Safari / Chrome /
 * Firefox the way the operator expects. The Rust side validates the
 * scheme, so passing a `javascript:` or `file:` URL no-ops. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
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

export interface CalendarPublishRuleRow {
  eventKey: string;
  metadataJson: string;
  updatedAt: number;
}

export function calendarPublishRulesLoad(): Promise<CalendarPublishRuleRow[]> {
  return invoke("calendar_publish_rules_load");
}

export function calendarPublishRulesSave(
  rows: CalendarPublishRuleRow[],
): Promise<void> {
  return invoke("calendar_publish_rules_save", { rows });
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

// ---------------------------------------------------------------------------
// Local-first Notes surface. These rows live in workspace.db only and do not
// participate in Site Admin publish/release flows.
// ---------------------------------------------------------------------------

export interface NoteRow {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  sortOrder: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDetail extends NoteRow {
  bodyMdx: string;
}

export interface NoteSearchResult {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  excerpt: string;
  updatedAt: number;
}

export interface NotesMutation {
  removed: string[];
  updated: NoteRow[];
}

export interface NoteCreated {
  note: NoteDetail;
  mutation: NotesMutation;
}

export function notesList(): Promise<NoteRow[]> {
  return invoke("notes_list");
}

export function notesListArchived(): Promise<NoteRow[]> {
  return invoke("notes_list_archived");
}

export function notesGet(id: string): Promise<NoteDetail | null> {
  return invoke("notes_get", { id });
}

export function notesCreate(params: {
  afterId?: string | null;
  parentId?: string | null;
  title?: string | null;
}): Promise<NoteCreated> {
  const payload: Record<string, string | null> = {};
  if (params.afterId !== undefined) payload.afterId = params.afterId;
  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.title !== undefined) payload.title = params.title;
  return invoke("notes_create", { params: payload });
}

export function notesUpdate(params: {
  bodyMdx?: string;
  icon?: string | null;
  id: string;
  title?: string;
}): Promise<NoteDetail> {
  const payload: {
    bodyMdx?: string;
    icon?: string | null;
    id: string;
    title?: string;
  } = { id: params.id };
  if (params.bodyMdx !== undefined) payload.bodyMdx = params.bodyMdx;
  if (params.icon !== undefined) payload.icon = params.icon;
  if (params.title !== undefined) payload.title = params.title;
  return invoke("notes_update", { params: payload });
}

export function notesMove(params: {
  edge?: "before" | "after" | null;
  id: string;
  parentId?: string | null;
  targetId?: string | null;
}): Promise<NotesMutation> {
  const payload: {
    edge?: "before" | "after" | null;
    id: string;
    parentId?: string | null;
    targetId?: string | null;
  } = { id: params.id };
  if (params.edge !== undefined) payload.edge = params.edge;
  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.targetId !== undefined) payload.targetId = params.targetId;
  return invoke("notes_move", { params: payload });
}

export function notesArchive(id: string): Promise<NotesMutation> {
  return invoke("notes_archive", { id });
}

export function notesUnarchive(id: string): Promise<NotesMutation> {
  return invoke("notes_unarchive", { id });
}

export function notesSearch(query: string): Promise<NoteSearchResult[]> {
  return invoke("notes_search", { params: { query } });
}

export interface NoteAssetResult {
  url: string;
  key: string;
  size: number;
  contentType: string;
}

export function notesSaveAsset(params: {
  contentType: string;
  base64: string;
}): Promise<NoteAssetResult> {
  return invoke("notes_save_asset", { params });
}

// Phase 5b — write outbox. Mutating site-admin requests that fail at
// the network layer get queued here; outbox_drain replays them when
// connectivity returns. The Rust side stores `body_json` as a string
// blob and replays the same (method, path, body) tuple, so the queue
// works for any site-admin endpoint, not just content writes.

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
