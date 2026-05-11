import { Download, HardDrive, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import type {
  WorkspaceBackupCreateResult,
  WorkspaceBackupInfo,
  WorkspaceBackupRestoreResult,
} from "../lib/tauri";

export function defaultWorkspaceBackupFilename(): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `workspace-backup-${stamp}.db`;
}

function pathLeaf(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "Not created yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function DataIconLarge() {
  return (
    <HardDrive
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={28}
      strokeWidth={1.6}
    />
  );
}

export function DataSettingsPanel({
  error,
  info,
  lastBackup,
  lastRestore,
  loading,
  message,
  onCreateBackup,
  onRefresh,
  onRestoreBackup,
}: {
  error: string | null;
  info: WorkspaceBackupInfo | null;
  lastBackup: WorkspaceBackupCreateResult | null;
  lastRestore: WorkspaceBackupRestoreResult | null;
  loading: boolean;
  message: string | null;
  onCreateBackup: () => void;
  onRefresh: () => void;
  onRestoreBackup: () => void;
}) {
  return (
    <div className="settings-window__section settings-data">
      <div className="settings-window__section-head">
        <DataIconLarge />
        <div>
          <h1 id="settings-window-title">Data</h1>
          <p>{info?.exists ? `${formatBytes(info.sizeBytes)} local database` : "Local database"}</p>
        </div>
      </div>

      <div className="settings-data-summary">
        <div>
          <strong>Workspace database</strong>
          <code title={info?.dbPath ?? ""}>{info ? pathLeaf(info.dbPath) : "Loading..."}</code>
        </div>
        <dl>
          <div>
            <dt>Size</dt>
            <dd>{info?.exists ? formatBytes(info.sizeBytes) : "None"}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatTimestamp(info?.modifiedAtMs)}</dd>
          </div>
        </dl>
      </div>

      <div className="settings-data-actions">
        <button type="button" className="btn btn--primary" onClick={onCreateBackup} disabled={loading || !info?.exists}>
          <Download absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Create Backup
        </button>
        <button type="button" className="btn btn--secondary" onClick={onRestoreBackup} disabled={loading}>
          <Upload absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Restore Backup
        </button>
        <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={loading}>
          <RefreshCcw absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      <div className="settings-data-note">
        <ShieldCheck absoluteStrokeWidth size={16} strokeWidth={1.8} />
        <span>
          Backups include local notes, todos, projects, contacts, settings, and debug-mode secure values stored in
          workspace.db.
        </span>
      </div>

      {message ? <div className="workspace-status-banner workspace-status-banner--success">{message}</div> : null}
      {error ? <div className="workspace-status-banner workspace-status-banner--error">{error}</div> : null}

      <div className="settings-data-history">
        <div>
          <strong>Last backup</strong>
          <small>{lastBackup ? `${formatBytes(lastBackup.sizeBytes)} · ${formatTimestamp(lastBackup.createdAtMs)}` : "None this session"}</small>
          {lastBackup ? <code title={lastBackup.path}>{pathLeaf(lastBackup.path)}</code> : null}
        </div>
        <div>
          <strong>Last restore</strong>
          <small>{lastRestore ? formatTimestamp(lastRestore.restoredAtMs) : "None this session"}</small>
          {lastRestore?.rollbackBackupPath ? (
            <code title={lastRestore.rollbackBackupPath}>Rollback: {pathLeaf(lastRestore.rollbackBackupPath)}</code>
          ) : null}
        </div>
      </div>
    </div>
  );
}
