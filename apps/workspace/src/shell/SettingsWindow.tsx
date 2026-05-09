import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  CheckCircle2,
  Database,
  FileClock,
  RefreshCcw,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import type { WorkspaceModuleDefinition } from "../modules/types";
import {
  workspaceMcpAuditRecent,
  workspaceMcpConfirmationDecide,
  workspaceMcpConfirmationsList,
  workspaceMcpSettingsUpdate,
  workspaceMcpStatus,
} from "../lib/tauri";
import type {
  WorkspaceMcpAuditEntry,
  WorkspaceMcpConfirmation,
  WorkspaceMcpSettings,
  WorkspaceMcpStatus,
} from "../lib/tauri";

type SettingsSection = "modules" | "ai";

const DEFAULT_MCP_SETTINGS: WorkspaceMcpSettings = {
  enabled: true,
  writeMode: "local-write",
  requireConfirmationForWrites: true,
  allowNotesWrite: true,
  allowTodosWrite: true,
  allowProjectsWrite: true,
  allowSiteAdminWrite: true,
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
  const title = typeof record.title === "string" ? record.title : "";
  if (title) return title;
  const id = typeof record.id === "string" ? record.id : "";
  if (id) return id;
  const pageId = typeof record.pageId === "string" ? record.pageId : "";
  if (pageId) return pageId;
  return "";
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
          <h1 id="settings-window-title">Modules</h1>
          <p>{enabledModuleIds.length} enabled</p>
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
            return (
              <div className="settings-ai-confirmation-row" key={entry.id}>
                <span className="settings-ai-confirmation-row__body">
                  <strong>{entry.summary}</strong>
                  <small>{snippet ? `${entry.tool} · ${snippet}` : entry.tool}</small>
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
        <McpCapabilityRow
          title="Notes writes"
          detail="Create pages and append blocks"
          checked={settings.allowNotesWrite}
          disabled={!writable}
          onChange={(allowNotesWrite) => onUpdateSettings({ allowNotesWrite })}
        />
        <McpCapabilityRow
          title="Todos writes"
          detail="Create, update, and complete local tasks"
          checked={settings.allowTodosWrite}
          disabled={!writable}
          onChange={(allowTodosWrite) => onUpdateSettings({ allowTodosWrite })}
        />
        <McpCapabilityRow
          title="Projects writes"
          detail="Create projects and add project links"
          checked={settings.allowProjectsWrite}
          disabled={!writable}
          onChange={(allowProjectsWrite) => onUpdateSettings({ allowProjectsWrite })}
        />
        <McpCapabilityRow
          title="Site Admin writes"
          detail={settings.siteAdminWriteTarget === "api"
            ? "Create pages in staging Site Admin, then publish content"
            : "Write local content files for recovery workflows"}
          checked={settings.allowSiteAdminWrite}
          disabled={!writable}
          onChange={(allowSiteAdminWrite) => onUpdateSettings({ allowSiteAdminWrite })}
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
        <McpCapabilityRow
          title="Calendar writes"
          detail="Create local Workspace calendar events"
          checked={settings.allowCalendarWrite}
          disabled={!writable}
          onChange={(allowCalendarWrite) => onUpdateSettings({ allowCalendarWrite })}
        />
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

  const navItems = useMemo(
    () => [
      { id: "modules" as const, label: "Modules", icon: <Settings absoluteStrokeWidth size={14} strokeWidth={1.7} /> },
      { id: "ai" as const, label: "AI Access", icon: <Bot absoluteStrokeWidth size={14} strokeWidth={1.7} /> },
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
