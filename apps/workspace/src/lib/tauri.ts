import { invoke } from "@tauri-apps/api/core";

/** Macos traffic-light inset tuner (no-op on other platforms). Dev helper
 * for finding the exact (x, y) that visually centers the lights inside
 * the workspace titlebar. */
export function debugSetTrafficLights(x: number, y: number): Promise<void> {
  return invoke("debug_set_traffic_lights", { x, y });
}

/** Open an http(s) URL in the user's default browser. The Tauri webview
 * doesn't honour `<a target="_blank">` on its own; this routes through
 * the Rust `open` crate so external links land in Safari / Chrome /
 * Firefox the way the operator expects. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

/** Open the operating-system account manager where EventKit calendars
 * are added/removed. Calendar accounts remain owned by macOS; the app
 * only refreshes and filters the calendars it can read. */
export function openCalendarAccountSettings(): Promise<void> {
  return invoke("open_calendar_account_settings");
}

/** Open macOS Settings → Privacy & Security → Calendars so the user
 * can flip the EventKit permission. Used by the Calendar surface's
 * "Calendar access blocked" screen. */
export function openMacosCalendarPrivacy(): Promise<void> {
  return invoke("open_macos_calendar_privacy");
}

/** Raw credential storage access — prefer `createNamespacedSecureStorage`
 * so modules don't collide on key names. Tauri uses Keychain in production
 * and local workspace.db storage in debug builds. */
export function secureStoreSet(key: string, value: string): Promise<void> {
  return invoke("secure_store_set", { key, value });
}

export function secureStoreGet(key: string): Promise<string | null> {
  return invoke("secure_store_get", { key });
}

export function secureStoreDelete(key: string): Promise<void> {
  return invoke("secure_store_delete", { key });
}

export function secureStoreBackend(): Promise<"keychain" | "local-db"> {
  return invoke("secure_store_backend");
}

export type WorkspaceMcpWriteMode = "read-only" | "local-write";

export interface WorkspaceMcpSettings {
  enabled: boolean;
  writeMode: WorkspaceMcpWriteMode;
  requireConfirmationForWrites: boolean;
  allowNotesWrite: boolean;
  allowTodosWrite: boolean;
  allowProjectsWrite: boolean;
  allowSiteAdminWrite: boolean;
  allowCalendarWrite: boolean;
}

export interface WorkspaceMcpStatus {
  ready: boolean;
  dbPath: string;
  settingsPath: string;
  auditPath: string;
  confirmationsPath: string;
  serverCommand: string;
  serverArgs: string[];
  settings: WorkspaceMcpSettings;
  toolCount: number;
  writableToolCount: number;
  recentAuditCount: number;
  pendingConfirmationCount: number;
}

export interface WorkspaceMcpAuditEntry {
  at: string | null;
  tool: string | null;
  id: string | null;
  title: string | null;
  summary: string;
  raw: unknown;
}

export interface WorkspaceMcpConfirmation {
  id: string;
  status: string;
  tool: string;
  summary: string;
  requestedAt: string | null;
  decidedAt: string | null;
  consumedAt: string | null;
  preview: unknown;
  args: unknown;
}

export function workspaceMcpStatus(): Promise<WorkspaceMcpStatus> {
  return invoke("workspace_mcp_status");
}

export function workspaceMcpSettingsGet(): Promise<WorkspaceMcpSettings> {
  return invoke("workspace_mcp_settings_get");
}

export function workspaceMcpSettingsUpdate(
  settings: WorkspaceMcpSettings,
): Promise<WorkspaceMcpSettings> {
  return invoke("workspace_mcp_settings_update", { settings });
}

export function workspaceMcpAuditRecent(
  limit = 12,
): Promise<WorkspaceMcpAuditEntry[]> {
  return invoke("workspace_mcp_audit_recent", { limit });
}

export function workspaceMcpConfirmationsList(
  status = "pending",
): Promise<WorkspaceMcpConfirmation[]> {
  return invoke("workspace_mcp_confirmations_list", { status });
}

export function workspaceMcpConfirmationDecide(
  id: string,
  decision: "approve" | "reject",
): Promise<WorkspaceMcpConfirmation> {
  return invoke("workspace_mcp_confirmation_decide", { id, decision });
}
