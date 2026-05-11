import { Download, HardDrive, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type {
  WorkspaceBackupCreateResult,
  WorkspaceBackupInfo,
  WorkspaceBackupListEntry,
  WorkspaceBackupPreview,
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
  preview,
  recentBackups,
  onCreateAutoBackup,
  onCreateBackup,
  onRefresh,
  onRestoreBackup,
  onRestoreBackupFromPath,
}: {
  error: string | null;
  info: WorkspaceBackupInfo | null;
  lastBackup: WorkspaceBackupCreateResult | null;
  lastRestore: WorkspaceBackupRestoreResult | null;
  loading: boolean;
  message: string | null;
  preview: WorkspaceBackupPreview | null;
  recentBackups: readonly WorkspaceBackupListEntry[];
  onCreateAutoBackup: () => void;
  onCreateBackup: () => void;
  onRefresh: () => void;
  onRestoreBackup: () => void;
  onRestoreBackupFromPath: (path: string) => void;
}) {
  const previewDelta = preview?.tables.filter((table) => table.currentCount !== table.backupCount) ?? [];
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
        <button type="button" className="btn btn--primary" onClick={onCreateAutoBackup} disabled={loading || !info?.exists}>
          <RefreshCw absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Auto Backup
        </button>
        <button type="button" className="btn btn--primary" onClick={onCreateBackup} disabled={loading || !info?.exists}>
          <Download absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Create Backup
        </button>
        <button type="button" className="btn btn--secondary" onClick={onRestoreBackup} disabled={loading}>
          <Upload absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Restore Backup
        </button>
        <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={loading}>
          <RefreshCw absoluteStrokeWidth size={14} strokeWidth={1.8} />
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

      {preview ? (
        <section className="settings-data-preview" aria-label="Backup restore preview">
          <header>
            <strong>Restore preview</strong>
            <small>{previewDelta.length ? `${previewDelta.length} changed tables` : "Tracked counts match"}</small>
          </header>
          <div className="settings-data-preview__grid">
            {preview.tables.slice(0, 8).map((table) => (
              <div key={table.name}>
                <span>{table.name}</span>
                <strong>
                  {table.currentCount} → {table.backupCount}
                </strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="settings-data-backups" aria-label="Recent backups">
        <header>
          <strong>Recent backups</strong>
          <small>{recentBackups.length}</small>
        </header>
        {recentBackups.length ? (
          <div className="settings-data-backups__list">
            {recentBackups.slice(0, 6).map((entry) => (
              <div className="settings-data-backup-row" key={entry.path}>
                <span>
                  <strong>{entry.automatic ? "Automatic" : "Manual"}</strong>
                  <small>{entry.name} · {formatBytes(entry.sizeBytes)} · {formatTimestamp(entry.modifiedAtMs)}</small>
                </span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={loading}
                  onClick={() => onRestoreBackupFromPath(entry.path)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-window__empty settings-window__empty--compact">
            <strong>No backups yet</strong>
            <span>Create one manually or let the daily auto backup run.</span>
          </div>
        )}
      </section>
    </div>
  );
}
