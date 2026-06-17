import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { confirm as confirmDialog, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  CheckCircle2,
  Database,
  FileClock,
  HardDrive,
  KeyRound,
  RefreshCcw,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { DataSettingsPanel, defaultWorkspaceBackupFilename } from "./DataSettingsPanel";
import type { WorkspaceModuleDefinition } from "../modules/types";
import {
  workspaceBackupAuto,
  workspaceBackupCreate,
  workspaceBackupInfo,
  workspaceBackupPreview,
  workspaceBackupRestore,
  workspaceBackupsList,
  workspaceMcpAuditRecent,
  workspaceMcpConfirmationDecide,
  workspaceMcpConfirmationsList,
  workspaceMcpSettingsUpdate,
  workspaceMcpStatus,
} from "../lib/tauri";
import type {
  WorkspaceBackupInfo,
  WorkspaceBackupCreateResult,
  WorkspaceBackupRestoreResult,
  WorkspaceBackupListEntry,
  WorkspaceBackupPreview,
  WorkspaceMcpAuditEntry,
  WorkspaceMcpConfirmation,
  WorkspaceMcpSettings,
  WorkspaceMcpStatus,
} from "../lib/tauri";

type SettingsSection = "modules" | "data" | "ai";

const DEFAULT_MCP_SETTINGS: WorkspaceMcpSettings = {
  enabled: true,
  writeMode: "local-write",
  requireConfirmationForWrites: true,
  allowNotesWrite: false,
  allowTodosWrite: false,
  allowProjectsWrite: false,
  allowContactsWrite: false,
  allowSiteAdminWrite: true,
  allowReleaseWrite: false,
  siteAdminWriteTarget: "api",
  siteAdminBaseUrl: "https://staging.jinkunchen.com",
  siteAdminFallbackToLocal: true,
  allowCalendarWrite: false,
};

function SettingsIconLarge() {
  return (
    <Settings
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={28}
      strokeWidth={1.6}
    />
  );
}

function AiIconLarge() {
  return (
    <Bot
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={28}
      strokeWidth={1.6}
    />
  );
}

function formatAuditTime(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function pathLeaf(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

function previewSnippet(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  if (action) return action;
  const slug = typeof record.slug === "string" ? record.slug : "";
  if (slug) return slug;
  const title = typeof record.title === "string" ? record.title : "";
  if (title) return title;
  const id = typeof record.id === "string" ? record.id : "";
  if (id) return id;
  const pageId = typeof record.pageId === "string" ? record.pageId : "";
  if (pageId) return pageId;
  return "";
}

function previewMeta(value: unknown): { label: string; value: string }[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const entries: { label: string; value: string }[] = [];
  const push = (label: string, raw: unknown) => {
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") return;
    const value = String(raw).trim();
    if (!value) return;
    entries.push({ label, value: value.length > 44 ? `${value.slice(0, 41)}...` : value });
  };
  push("target", record.backend);
  push("api", record.baseUrl);
  push("action", record.action);
  push("path", record.path ?? record.routePath ?? record.relPath);
  push("expected", record.expectedFileSha ?? record.expectedSiteConfigSha ?? record.expectedProtectedRoutesSha);
  return entries.slice(0, 5);
}

function previewDetail(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const detail =
    typeof record.diffPreview === "string"
      ? record.diffPreview
      : typeof record.sourcePreview === "string"
        ? record.sourcePreview
        : "";
  if (!detail.trim()) return "";
  return detail.length > 1_800 ? `${detail.slice(0, 1_800).trimEnd()}\n...` : detail;
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="settings-module-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked ? "true" : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function ModulesSettingsPanel({
  enabledModuleIds,
  modules,
  onSetModuleEnabled,
}: {
  enabledModuleIds: readonly string[];
  modules: readonly WorkspaceModuleDefinition[];
  onSetModuleEnabled: (moduleId: string, enabled: boolean) => void;
}) {
  return (
    <div className="settings-window__section">
      <div className="settings-window__section-head">
        <SettingsIconLarge />
        <div>
          <h1 id="settings-window-title">Tools</h1>
          <p>{enabledModuleIds.length} active</p>
        </div>
      </div>
      <div className="settings-modules-list">
        {modules.map((module) => {
          const enabled = enabledModuleIds.includes(module.id);
          return (
            <div className="settings-module-row" key={module.id}>
              <span className="settings-module-row__icon" aria-hidden="true">
                {module.surface.icon}
              </span>
              <span className="settings-module-row__body">
                <strong>{module.surface.title}</strong>
                {module.surface.description ? (
                  <small>{module.surface.description}</small>
                ) : null}
              </span>
              <ToggleSwitch
                checked={enabled}
                label={`${enabled ? "Disable" : "Enable"} ${module.surface.title}`}
                onChange={(next) => onSetModuleEnabled(module.id, next)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function McpPathCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="settings-ai-path-card" title={value}>
      <span className="settings-ai-path-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{label}</strong>
        <code>{pathLeaf(value)}</code>
      </span>
    </div>
  );
}

function McpCapabilityRow({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-ai-capability-row" data-disabled={disabled ? "true" : undefined}>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ToggleSwitch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
  );
}

function McpSelectRow({
  title,
  detail,
  value,
  disabled,
  options,
  onChange,
}: {
  title: string;
  detail: string;
  value: string;
  disabled?: boolean;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-ai-capability-row settings-ai-select-row" data-disabled={disabled ? "true" : undefined}>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function McpConfirmationsSection({
  confirmations,
  onDecide,
}: {
  confirmations: readonly WorkspaceMcpConfirmation[];
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  return (
    <section className="settings-ai-confirmations" aria-label="Pending AI confirmations">
      <header>
        <strong>Pending confirmations</strong>
        <small>{confirmations.length}</small>
      </header>
      {confirmations.length ? (
        <div className="settings-ai-confirmations__list">
          {confirmations.map((entry) => {
            const snippet = previewSnippet(entry.preview);
            const detail = previewDetail(entry.preview);
            const meta = previewMeta(entry.preview);
            return (
              <div className="settings-ai-confirmation-row" key={entry.id}>
                <span className="settings-ai-confirmation-row__body">
                  <strong>{entry.summary}</strong>
                  <small>{snippet ? `${entry.tool} · ${snippet}` : entry.tool}</small>
                  {meta.length ? (
                    <span className="settings-ai-confirmation-row__meta">
                      {meta.map((item) => (
                        <span key={`${entry.id}-${item.label}`}>
                          {item.label}: {item.value}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {detail ? (
                    <pre className="settings-ai-confirmation-row__preview">{detail}</pre>
                  ) : null}
                </span>
                <span className="settings-ai-confirmation-row__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => onDecide(entry.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => onDecide(entry.id, "reject")}
                  >
                    Reject
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="settings-window__empty settings-window__empty--compact">
          <strong>No pending confirmations</strong>
          <span>AI write requests that need approval will appear here.</span>
        </div>
      )}
    </section>
  );
}

function McpSettingsPanel({
  auditEntries,
  confirmations,
  error,
  loading,
  onDecideConfirmation,
  onRefresh,
  onUpdateSettings,
  status,
}: {
  auditEntries: readonly WorkspaceMcpAuditEntry[];
  confirmations: readonly WorkspaceMcpConfirmation[];
  error: string | null;
  loading: boolean;
  onDecideConfirmation: (id: string, decision: "approve" | "reject") => void;
  onRefresh: () => void;
  onUpdateSettings: (patch: Partial<WorkspaceMcpSettings>) => void;
  status: WorkspaceMcpStatus | null;
}) {
  const settings = status?.settings ?? DEFAULT_MCP_SETTINGS;
  const command = status
    ? [status.serverCommand, ...status.serverArgs].join(" ")
    : "npm run workspace:mcp";
  const writable = settings.enabled && settings.writeMode === "local-write";
  const credentials = status?.siteAdminCredentials;
  const credentialDetail = credentials
    ? [
        credentials.hasAppToken ? "app token" : "",
        credentials.hasCfAccess ? "CF Access" : "",
      ].filter(Boolean).join(" + ") || `Missing for ${credentials.baseUrl}`
    : "Not checked yet";
  const applyProfile = (profile: "read-only" | "daily" | "site") => {
    if (profile === "read-only") {
      onUpdateSettings({
        enabled: true,
        writeMode: "read-only",
        requireConfirmationForWrites: true,
        allowReleaseWrite: false,
        allowCalendarWrite: false,
      });
      return;
    }
    if (profile === "site") {
      onUpdateSettings({
        enabled: true,
        writeMode: "local-write",
        requireConfirmationForWrites: true,
        allowNotesWrite: false,
        allowTodosWrite: false,
        allowProjectsWrite: false,
        allowContactsWrite: false,
        allowSiteAdminWrite: true,
        allowReleaseWrite: false,
        siteAdminWriteTarget: "api",
        siteAdminFallbackToLocal: false,
        allowCalendarWrite: false,
      });
      return;
    }
    onUpdateSettings({
      enabled: true,
      writeMode: "local-write",
      requireConfirmationForWrites: true,
      allowNotesWrite: false,
      allowTodosWrite: false,
      allowProjectsWrite: false,
      allowContactsWrite: false,
      allowSiteAdminWrite: true,
      allowReleaseWrite: false,
      siteAdminWriteTarget: "api",
      siteAdminFallbackToLocal: true,
      allowCalendarWrite: true,
    });
  };

  return (
    <div className="settings-window__section settings-ai">
      <div className="settings-window__section-head">
        <AiIconLarge />
        <div>
          <h1 id="settings-window-title">AI Access</h1>
          <p>{status ? `${status.toolCount} tools · ${status.pendingConfirmationCount} pending` : "MCP control center"}</p>
        </div>
      </div>

      <div className="settings-ai-status-grid">
        <div className="settings-ai-status-card">
          <span className="settings-ai-status-card__icon" aria-hidden="true">
            <CheckCircle2 absoluteStrokeWidth size={18} strokeWidth={1.7} />
          </span>
          <span>
            <strong>{settings.enabled ? "Ready" : "Disabled"}</strong>
            <small>{settings.enabled ? "Client starts MCP on demand" : "Tool calls are blocked"}</small>
          </span>
        </div>
        <div className="settings-ai-status-card">
          <span className="settings-ai-status-card__icon" aria-hidden="true">
            <ShieldCheck absoluteStrokeWidth size={18} strokeWidth={1.7} />
          </span>
          <span>
            <strong>{settings.writeMode === "read-only" ? "Read only" : "Local write"}</strong>
            <small>Deploy actions stay hidden</small>
          </span>
        </div>
        <div className="settings-ai-status-card">
          <span className="settings-ai-status-card__icon" aria-hidden="true">
            <KeyRound absoluteStrokeWidth size={18} strokeWidth={1.7} />
          </span>
          <span>
            <strong>{credentials?.hasAnyCredentials ? "Site Admin signed in" : "Site Admin credentials"}</strong>
            <small>{credentialDetail}</small>
          </span>
        </div>
      </div>

      <div className="settings-ai-command">
        <span>
          <strong>Server command</strong>
          <code>{command}</code>
        </span>
        <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={loading}>
          <RefreshCcw absoluteStrokeWidth size={14} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      {error ? <div className="workspace-status-banner workspace-status-banner--error">{error}</div> : null}

      <div className="settings-ai-profile-strip" aria-label="AI permission profiles">
        <button type="button" onClick={() => applyProfile("daily")}>
          <strong>Site and calendar</strong>
          <small>Workspace writes with confirmation</small>
        </button>
        <button type="button" onClick={() => applyProfile("site")}>
          <strong>Site editing</strong>
          <small>Staging API writes only</small>
        </button>
        <button type="button" onClick={() => applyProfile("read-only")}>
          <strong>Read only</strong>
          <small>Search and inspect</small>
        </button>
      </div>

      {status ? (
        <div className="settings-ai-path-grid">
          <McpPathCard
            icon={<Database absoluteStrokeWidth size={16} strokeWidth={1.8} />}
            label="Database"
            value={status.dbPath}
          />
          <McpPathCard
            icon={<Settings absoluteStrokeWidth size={16} strokeWidth={1.8} />}
            label="Settings"
            value={status.settingsPath}
          />
          <McpPathCard
            icon={<FileClock absoluteStrokeWidth size={16} strokeWidth={1.8} />}
            label="Audit"
            value={status.auditPath}
          />
          <McpPathCard
            icon={<ShieldCheck absoluteStrokeWidth size={16} strokeWidth={1.8} />}
            label="Confirm"
            value={status.confirmationsPath}
          />
        </div>
      ) : null}

      <div className="settings-ai-permissions">
        <section className="settings-ai-permission-group">
          <header>
            <strong>Global</strong>
            <small>Server and confirmation behavior</small>
          </header>
        <McpCapabilityRow
          title="MCP enabled"
          detail="Allow local AI clients to use Workspace tools"
          checked={settings.enabled}
          onChange={(enabled) => onUpdateSettings({ enabled })}
        />
        <McpCapabilityRow
          title="Read-only mode"
          detail="AI can search and inspect, but cannot change data"
          checked={settings.writeMode === "read-only"}
          onChange={(readOnly) =>
            onUpdateSettings({ writeMode: readOnly ? "read-only" : "local-write" })
          }
        />
        <McpCapabilityRow
          title="Confirm writes"
          detail="AI write tools wait for approval in this panel"
          checked={settings.requireConfirmationForWrites}
          disabled={!writable}
          onChange={(requireConfirmationForWrites) =>
            onUpdateSettings({ requireConfirmationForWrites })
          }
        />
        </section>
        <section className="settings-ai-permission-group">
          <header>
            <strong>Site Admin</strong>
            <small>Staging content and public-site config</small>
          </header>
        <McpCapabilityRow
          title="Site Admin writes"
          detail={settings.siteAdminWriteTarget === "api"
            ? "Create pages in staging Site Admin, then publish content"
            : "Write local content files for recovery workflows"}
          checked={settings.allowSiteAdminWrite}
          disabled={!writable}
          onChange={(allowSiteAdminWrite) => onUpdateSettings({ allowSiteAdminWrite })}
        />
        <McpCapabilityRow
          title="Release jobs"
          detail="Create, cancel, and retry Release Center jobs"
          checked={settings.allowReleaseWrite}
          disabled={!writable || !settings.allowSiteAdminWrite}
          onChange={(allowReleaseWrite) => onUpdateSettings({ allowReleaseWrite })}
        />
        <McpSelectRow
          title="Site Admin target"
          detail={settings.siteAdminWriteTarget === "api"
            ? `Default: ${settings.siteAdminBaseUrl}`
            : "Local content/pages fallback"}
          value={settings.siteAdminWriteTarget}
          disabled={!writable || !settings.allowSiteAdminWrite}
          options={[
            { label: "Staging API", value: "api" },
            { label: "Local files", value: "local" },
          ]}
          onChange={(siteAdminWriteTarget) =>
            onUpdateSettings({
              siteAdminWriteTarget: siteAdminWriteTarget === "local" ? "local" : "api",
            })
          }
        />
        <McpCapabilityRow
          title="Local fallback"
          detail="Use local content files if Site Admin API credentials are unavailable"
          checked={settings.siteAdminFallbackToLocal}
          disabled={!writable || !settings.allowSiteAdminWrite || settings.siteAdminWriteTarget !== "api"}
          onChange={(siteAdminFallbackToLocal) => onUpdateSettings({ siteAdminFallbackToLocal })}
        />
        </section>
        <section className="settings-ai-permission-group">
          <header>
            <strong>Calendar</strong>
            <small>Local events and public projection</small>
          </header>
        <McpCapabilityRow
          title="Calendar writes"
          detail="Create local Workspace calendar events"
          checked={settings.allowCalendarWrite}
          disabled={!writable}
          onChange={(allowCalendarWrite) => onUpdateSettings({ allowCalendarWrite })}
        />
        </section>
      </div>

      <McpConfirmationsSection
        confirmations={confirmations}
        onDecide={onDecideConfirmation}
      />

      <section className="settings-ai-audit" aria-label="Recent AI activity">
        <header>
          <strong>Recent AI activity</strong>
          <small>{status?.recentAuditCount ?? auditEntries.length}</small>
        </header>
        {auditEntries.length ? (
          <div className="settings-ai-audit__list">
            {auditEntries.map((entry, index) => (
              <div className="settings-ai-audit__row" key={`${entry.at ?? "audit"}-${index}`}>
                <span>
                  <strong>{entry.summary}</strong>
                  <small>{entry.tool ?? "workspace.mcp"}</small>
                </span>
                <time>{formatAuditTime(entry.at)}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-window__empty settings-window__empty--compact">
            <strong>No AI activity yet</strong>
            <span>Write tools will appear here after an MCP client uses them.</span>
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsWindow({
  enabledModuleIds,
  modules,
  open,
  onClose,
  onSetModuleEnabled,
}: {
  enabledModuleIds: readonly string[];
  modules: readonly WorkspaceModuleDefinition[];
  open: boolean;
  onClose: () => void;
  onSetModuleEnabled: (moduleId: string, enabled: boolean) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("modules");
  const [mcpStatus, setMcpStatus] = useState<WorkspaceMcpStatus | null>(null);
  const [mcpAuditEntries, setMcpAuditEntries] = useState<WorkspaceMcpAuditEntry[]>([]);
  const [mcpConfirmations, setMcpConfirmations] = useState<WorkspaceMcpConfirmation[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [dataInfo, setDataInfo] = useState<WorkspaceBackupInfo | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<WorkspaceBackupCreateResult | null>(null);
  const [lastRestore, setLastRestore] = useState<WorkspaceBackupRestoreResult | null>(null);
  const [backupEntries, setBackupEntries] = useState<WorkspaceBackupListEntry[]>([]);
  const [backupPreview, setBackupPreview] = useState<WorkspaceBackupPreview | null>(null);

  const refreshMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const [nextStatus, nextAudit, nextConfirmations] = await Promise.all([
        workspaceMcpStatus(),
        workspaceMcpAuditRecent(12),
        workspaceMcpConfirmationsList("pending"),
      ]);
      setMcpStatus(nextStatus);
      setMcpAuditEntries(nextAudit);
      setMcpConfirmations(nextConfirmations);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpLoading(false);
    }
  }, []);

  const updateMcpSettings = useCallback(
    async (patch: Partial<WorkspaceMcpSettings>) => {
      const next = { ...(mcpStatus?.settings ?? DEFAULT_MCP_SETTINGS), ...patch };
      setMcpError(null);
      try {
        const saved = await workspaceMcpSettingsUpdate(next);
        setMcpStatus((current) => (current ? { ...current, settings: saved } : current));
        await refreshMcp();
      } catch (error) {
        setMcpError(error instanceof Error ? error.message : String(error));
      }
    },
    [mcpStatus?.settings, refreshMcp],
  );

  const decideMcpConfirmation = useCallback(
    async (id: string, decision: "approve" | "reject") => {
      setMcpError(null);
      try {
        await workspaceMcpConfirmationDecide(id, decision);
        await refreshMcp();
      } catch (error) {
        setMcpError(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMcp],
  );

  const refreshDataInfo = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      setDataInfo(await workspaceBackupInfo());
      setBackupEntries(await workspaceBackupsList());
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setDataLoading(false);
    }
  }, []);

  const createBackup = useCallback(async () => {
    setDataError(null);
    setDataMessage(null);
    const destinationPath = await save({
      defaultPath: defaultWorkspaceBackupFilename(),
      filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      title: "Create Workspace Backup",
    });
    if (!destinationPath) return;
    setDataLoading(true);
    try {
      const result = await workspaceBackupCreate(destinationPath);
      setLastBackup(result);
      setBackupPreview(null);
      setDataMessage(`Backup created: ${pathLeaf(result.path)}`);
      await refreshDataInfo();
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setDataLoading(false);
    }
  }, [refreshDataInfo]);

  const createAutoBackup = useCallback(async () => {
    setDataError(null);
    setDataMessage(null);
    setDataLoading(true);
    try {
      const result = await workspaceBackupAuto(10);
      if (result.backup) setLastBackup(result.backup);
      setDataMessage(
        result.created
          ? `Automatic backup created: ${pathLeaf(result.backup?.path ?? "")}`
          : result.skippedReason ?? "Automatic backup skipped.",
      );
      await refreshDataInfo();
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setDataLoading(false);
    }
  }, [refreshDataInfo]);

  const restoreBackupFromPath = useCallback(async (selectedPath: string) => {
    setDataError(null);
    setDataMessage(null);
    setDataLoading(true);
    try {
      const preview = await workspaceBackupPreview(selectedPath);
      setBackupPreview(preview);
      setDataLoading(false);
      const changedTables = preview.tables.filter(
        (table) => table.currentCount !== table.backupCount,
      );
      const summary = changedTables.length
        ? changedTables
            .slice(0, 6)
            .map((table) => `${table.name}: ${table.currentCount} → ${table.backupCount}`)
            .join("\n")
        : "Row counts match for tracked tables.";
      const confirmed = await confirmDialog(
        `Restore ${pathLeaf(preview.sourcePath)}?\n\n${summary}\n\nThe current database will be copied to a rollback backup first. Restart Workspace after restore.`,
        { kind: "warning", title: "Restore Workspace Backup" },
      );
      if (!confirmed) return;
      setDataLoading(true);
      const result = await workspaceBackupRestore(selectedPath);
      setLastRestore(result);
      setDataMessage("Backup restored. Restart Workspace to reload every surface.");
      await refreshDataInfo();
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setDataLoading(false);
    }
  }, [refreshDataInfo]);

  const restoreBackup = useCallback(async () => {
    const selectedPath = await openDialog({
      filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      multiple: false,
      title: "Restore Workspace Backup",
    });
    if (!selectedPath || Array.isArray(selectedPath)) return;
    await restoreBackupFromPath(selectedPath);
  }, [restoreBackupFromPath]);

  const navItems = useMemo(
    () => [
      { id: "modules" as const, label: "Tools", icon: <Settings absoluteStrokeWidth size={14} strokeWidth={1.7} /> },
      { id: "data" as const, label: "Data", icon: <HardDrive absoluteStrokeWidth size={14} strokeWidth={1.7} /> },
    ],
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || activeSection !== "ai") return;
    void refreshMcp();
  }, [activeSection, open, refreshMcp]);

  useEffect(() => {
    if (!open || activeSection !== "data") return;
    void refreshDataInfo();
  }, [activeSection, open, refreshDataInfo]);

  if (!open) return null;
  return (
    <div
      className="settings-window-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-window-title"
      >
        <aside className="settings-window__sidebar">
          <div className="settings-window__sidebar-title">Settings</div>
          {navItems.map((item) => (
            <button
              type="button"
              className="settings-window__nav-item"
              aria-current={activeSection === item.id ? "page" : undefined}
              key={item.id}
              onClick={() => setActiveSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </aside>
        <main className="settings-window__main">
          <button
            type="button"
            className="settings-window__close"
            onClick={onClose}
            aria-label="Close settings"
            title="Close"
          >
            <X absoluteStrokeWidth size={15} strokeWidth={1.9} />
          </button>
          {activeSection === "modules" ? (
            <ModulesSettingsPanel
              enabledModuleIds={enabledModuleIds}
              modules={modules}
              onSetModuleEnabled={onSetModuleEnabled}
            />
          ) : activeSection === "data" ? (
            <DataSettingsPanel
              error={dataError}
              info={dataInfo}
              lastBackup={lastBackup}
              lastRestore={lastRestore}
              loading={dataLoading}
              message={dataMessage}
              preview={backupPreview}
              recentBackups={backupEntries}
              onCreateAutoBackup={() => void createAutoBackup()}
              onCreateBackup={() => void createBackup()}
              onRefresh={() => void refreshDataInfo()}
              onRestoreBackup={() => void restoreBackup()}
              onRestoreBackupFromPath={(path) => void restoreBackupFromPath(path)}
            />
          ) : (
            <McpSettingsPanel
              auditEntries={mcpAuditEntries}
              confirmations={mcpConfirmations}
              error={mcpError}
              loading={mcpLoading}
              onDecideConfirmation={(id, decision) => void decideMcpConfirmation(id, decision)}
              onRefresh={() => void refreshMcp()}
              onUpdateSettings={(patch) => void updateMcpSettings(patch)}
              status={mcpStatus}
            />
          )}
        </main>
      </section>
    </div>
  );
}
