import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { BlockPopover } from "./block-popover";
import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import { useDragReorder } from "./shared/useDragReorder";
import type { ConfigSourceVersion, NavRow } from "./types";
import {
  clone,
  isNavDirty,
  navPatch,
  normalizeNavRow,
  productionReadOnlyMessage,
} from "./utils";

type ConfigSnapshot = {
  sourceVersion: ConfigSourceVersion;
  nav: NavRow[];
};

type NavGroupId = "top" | "more";

const COLLAPSED_STATE_KEY = "workspace.site-admin.navigation.collapsed.v1";

function parseConfigSnapshot(payload: Record<string, unknown>): ConfigSnapshot | null {
  const srcVersion = payload.sourceVersion as
    | { siteConfigSha?: string; branchSha?: string }
    | undefined;
  if (!srcVersion?.siteConfigSha || !srcVersion.branchSha) return null;
  return {
    sourceVersion: {
      siteConfigSha: srcVersion.siteConfigSha,
      branchSha: srcVersion.branchSha,
    },
    nav: Array.isArray(payload.nav) ? payload.nav.map(normalizeNavRow) : [],
  };
}

function sourceVersionFromResponse(data: unknown): ConfigSourceVersion | null {
  const payload = (data ?? {}) as Record<string, unknown>;
  const src = (payload.sourceVersion ?? {}) as {
    siteConfigSha?: unknown;
    branchSha?: unknown;
  };
  return typeof src.siteConfigSha === "string" && typeof src.branchSha === "string"
    ? { siteConfigSha: src.siteConfigSha, branchSha: src.branchSha }
    : null;
}

function sortedRows(rows: NavRow[], drafts: Record<string, NavRow>, group: NavGroupId) {
  return rows
    .map((row) => drafts[row.rowId] ?? row)
    .filter((row) => row.group === group)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

// Persist which groups the operator has collapsed. The map lives on
// localStorage so toggling state survives panel switches and app reloads
// — toggling a group every time the panel opens would feel hostile.
function loadCollapsedState(): Record<NavGroupId, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STATE_KEY);
    if (!raw) return { top: false, more: false };
    const parsed = JSON.parse(raw) as Partial<Record<NavGroupId, boolean>>;
    return {
      top: parsed.top === true,
      more: parsed.more === true,
    };
  } catch {
    return { top: false, more: false };
  }
}

function persistCollapsedState(value: Record<NavGroupId, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_STATE_KEY, JSON.stringify(value));
  } catch {
    // quota / private mode — drop silently; the in-memory state still works.
  }
}

export function NavigationPanel() {
  const { productionReadOnly, request, setMessage } = useSiteAdmin();
  const { setTopbarSaveAction } = useSiteAdminEphemeral();
  const [sourceVersion, setSourceVersion] = useState<ConfigSourceVersion | null>(null);
  const [baseRows, setBaseRows] = useState<NavRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, NavRow>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [collapsed, setCollapsedState] = useState<Record<NavGroupId, boolean>>(() =>
    loadCollapsedState(),
  );

  const setCollapsed = useCallback((group: NavGroupId, value: boolean) => {
    setCollapsedState((prev) => {
      const next = { ...prev, [group]: value };
      persistCollapsedState(next);
      return next;
    });
  }, []);

  const dirtyRows = useMemo(
    () =>
      baseRows.filter((row) => {
        const draft = drafts[row.rowId];
        return draft ? isNavDirty(row, draft) : false;
      }),
    [baseRows, drafts],
  );

  const topRows = useMemo(() => sortedRows(baseRows, drafts, "top"), [baseRows, drafts]);
  const moreRows = useMemo(() => sortedRows(baseRows, drafts, "more"), [baseRows, drafts]);

  const applySnapshot = useCallback((snapshot: ConfigSnapshot) => {
    setSourceVersion(snapshot.sourceVersion);
    setBaseRows(snapshot.nav);
    setDrafts(Object.fromEntries(snapshot.nav.map((row) => [row.rowId, clone(row)])));
    setConflict(false);
  }, []);

  const loadConfig = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      const response = await request("/api/site-admin/config", "GET");
      setLoading(false);
      if (!response.ok) {
        if (!options.silent) {
          setMessage("error", `Load navigation failed: ${response.code}: ${response.error}`);
        }
        return false;
      }
      const snapshot = parseConfigSnapshot((response.data ?? {}) as Record<string, unknown>);
      if (!snapshot) {
        if (!options.silent) setMessage("error", "Load navigation failed: missing sourceVersion");
        return false;
      }
      applySnapshot(snapshot);
      if (!options.silent) setMessage("success", "Navigation loaded.");
      return true;
    },
    [applySnapshot, request, setMessage],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Initial navigation hydration is an async site-admin request; state updates happen after the request resolves. */
  useEffect(() => {
    void loadConfig({ silent: true });
  }, [loadConfig]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateDraft = useCallback(
    <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => {
      setDrafts((prev) => {
        const existing = prev[rowId];
        if (!existing) return prev;
        return { ...prev, [rowId]: { ...existing, [key]: value } };
      });
    },
    [],
  );

  const reorderGroup = useCallback(
    (group: NavGroupId, from: number, to: number) => {
      setDrafts((prev) => {
        const rows = sortedRows(baseRows, prev, group);
        if (from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
          return prev;
        }
        const nextRows = rows.slice();
        const [moved] = nextRows.splice(from, 1);
        nextRows.splice(to, 0, moved);
        const next = { ...prev };
        nextRows.forEach((row, index) => {
          next[row.rowId] = { ...row, order: (index + 1) * 10 };
        });
        return next;
      });
    },
    [baseRows],
  );

  const saveNavigation = useCallback(async () => {
    if (productionReadOnly) {
      setMessage("warn", productionReadOnlyMessage("save navigation"));
      return;
    }
    if (conflict) {
      setMessage("warn", "Navigation is in conflict state. Reload latest before saving.");
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Navigation sourceVersion missing. Reload latest first.");
      return;
    }
    const rows = dirtyRows;
    if (rows.length === 0) {
      setMessage("warn", "No navigation changes to save.");
      return;
    }
    setSaving(true);
    let expectedSiteConfigSha = sourceVersion.siteConfigSha;
    for (const base of rows) {
      const draft = drafts[base.rowId];
      if (!draft) continue;
      const patch = navPatch(base, draft);
      if (!Object.keys(patch).length) continue;
      const response = await request("/api/site-admin/config", "POST", {
        kind: "nav-update",
        rowId: base.rowId,
        patch,
        expectedSiteConfigSha,
      });
      if (!response.ok) {
        setSaving(false);
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          setConflict(true);
          setMessage("warn", "Save navigation failed with SOURCE_CONFLICT. Reload latest and apply your edit again.");
          return;
        }
        setMessage("error", `Save navigation failed: ${response.code}: ${response.error}`);
        return;
      }
      const nextVersion = sourceVersionFromResponse(response.data);
      if (nextVersion) expectedSiteConfigSha = nextVersion.siteConfigSha;
    }
    setSaving(false);
    setMessage("success", "Navigation saved to source branch. Publish staging separately.");
    await loadConfig({ silent: true });
  }, [
    conflict,
    dirtyRows,
    drafts,
    loadConfig,
    productionReadOnly,
    request,
    setMessage,
    sourceVersion,
  ]);

  // The "+" button on each group header creates a placeholder row server-
  // side and reloads. The user fills the label / URL inline afterward.
  // Placeholders use obvious "this is fresh" defaults so a forgotten edit
  // stays visible during the next review.
  const addRowToGroup = useCallback(
    async (group: NavGroupId) => {
      if (productionReadOnly) {
        setMessage("warn", productionReadOnlyMessage("create navigation rows"));
        return;
      }
      if (!sourceVersion?.siteConfigSha) {
        setMessage("error", "Navigation sourceVersion missing. Reload latest first.");
        return;
      }
      const groupRows = sortedRows(baseRows, drafts, group);
      const nextOrder = groupRows.length
        ? Math.max(...groupRows.map((row) => row.order)) + 10
        : 10;
      setCreating(true);
      const response = await request("/api/site-admin/config", "POST", {
        kind: "nav-create",
        input: {
          label: "New link",
          href: "/",
          group,
          enabled: true,
          order: nextOrder,
        },
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });
      setCreating(false);
      if (!response.ok) {
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          setConflict(true);
          setMessage(
            "warn",
            "Create navigation item failed with SOURCE_CONFLICT. Reload latest and try again.",
          );
          return;
        }
        setMessage(
          "error",
          `Create navigation item failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      // Make sure the user sees what they just added — pop the group open
      // even if it was previously collapsed.
      setCollapsed(group, false);
      setMessage("success", "Navigation item added. Edit label and URL, then save.");
      await loadConfig({ silent: true });
    },
    [
      baseRows,
      drafts,
      loadConfig,
      productionReadOnly,
      request,
      setCollapsed,
      setMessage,
      sourceVersion,
    ],
  );

  useEffect(() => {
    setTopbarSaveAction({
      dirty: dirtyRows.length > 0,
      disabled:
        productionReadOnly ||
        loading ||
        saving ||
        conflict ||
        dirtyRows.length === 0,
      label: `Save Navigation (${dirtyRows.length})`,
      onSave: () => {
        void saveNavigation();
      },
      saving,
      title: productionReadOnly
        ? "Production is inspect-only. Switch to Staging to save navigation."
        : conflict
          ? "Reload latest before saving navigation."
          : undefined,
    });
    return () => setTopbarSaveAction(null);
  }, [
    conflict,
    dirtyRows.length,
    loading,
    productionReadOnly,
    saveNavigation,
    saving,
    setTopbarSaveAction,
  ]);

  return (
    <section className="surface-card nav-editor">
      <header className="nav-editor__header">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Navigation
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Header links for the public site. Click a row to edit, drag to
            reorder, then save once.
          </p>
        </div>
        <div className="nav-editor__actions">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadConfig()}
            disabled={loading || saving}
          >
            Reload latest
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void saveNavigation()}
            disabled={
              productionReadOnly ||
              loading ||
              saving ||
              conflict ||
              dirtyRows.length === 0
            }
          >
            {saving ? "Saving..." : `Save Navigation${dirtyRows.length ? ` (${dirtyRows.length})` : ""}`}
          </button>
        </div>
      </header>
      <SiteAdminEnvironmentBanner actionLabel="save navigation" />
      {conflict ? (
        <div className="site-admin-conflict-banner" role="alert">
          <span>Navigation changed remotely. Reload latest before saving again.</span>
          <button className="btn btn--secondary" type="button" onClick={() => void loadConfig()}>
            Reload latest
          </button>
        </div>
      ) : null}
      {sourceVersion ? null : (
        <p className="nav-editor__status">Navigation not loaded.</p>
      )}

      <NavigationGroup
        title="Top bar"
        group="top"
        rows={topRows}
        baseRows={baseRows}
        readOnly={productionReadOnly}
        creating={creating}
        collapsed={collapsed.top}
        onToggleCollapsed={() => setCollapsed("top", !collapsed.top)}
        onReorder={reorderGroup}
        onUpdate={updateDraft}
        onAdd={() => void addRowToGroup("top")}
      />
      <NavigationGroup
        title="More menu"
        group="more"
        rows={moreRows}
        baseRows={baseRows}
        readOnly={productionReadOnly}
        creating={creating}
        collapsed={collapsed.more}
        onToggleCollapsed={() => setCollapsed("more", !collapsed.more)}
        onReorder={reorderGroup}
        onUpdate={updateDraft}
        onAdd={() => void addRowToGroup("more")}
      />

      <section className="nav-editor__preview" aria-label="Navigation preview">
        <header>
          <h2>Preview</h2>
          <span>enabled links only</span>
        </header>
        <nav>
          {[...topRows, ...moreRows]
            .filter((row) => row.enabled)
            .map((row) => (
              <a href={row.href || "#"} key={row.rowId}>
                {row.label || "Untitled"}
              </a>
            ))}
        </nav>
      </section>
    </section>
  );
}

interface NavigationGroupProps {
  title: string;
  group: NavGroupId;
  rows: NavRow[];
  baseRows: NavRow[];
  readOnly: boolean;
  creating: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onReorder: (group: NavGroupId, from: number, to: number) => void;
  onUpdate: <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => void;
  onAdd: () => void;
}

function NavigationGroup({
  title,
  group,
  rows,
  baseRows,
  readOnly,
  creating,
  collapsed,
  onToggleCollapsed,
  onReorder,
  onUpdate,
  onAdd,
}: NavigationGroupProps) {
  const { getHandleProps, getRowProps } = useDragReorder(rows.length, (from, to) =>
    onReorder(group, from, to),
  );
  return (
    <section
      className="nav-group"
      data-collapsed={collapsed ? "true" : undefined}
      data-group={group}
    >
      <header className="nav-group__header">
        <button
          type="button"
          className="nav-group__chevron"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <ChevronDown collapsed={collapsed} />
        </button>
        <span className="nav-group__title">{title}</span>
        {rows.length > 0 ? (
          <span className="nav-group__count">{rows.length}</span>
        ) : null}
        <span className="nav-group__spacer" aria-hidden="true" />
        <button
          type="button"
          className="nav-group__add"
          onClick={onAdd}
          disabled={readOnly || creating}
          aria-label={`Add link to ${title}`}
          title={`Add link to ${title}`}
        >
          <PlusIcon />
        </button>
      </header>
      {collapsed ? null : (
        <div className="nav-group__rows">
          {rows.length === 0 ? (
            <p className="nav-group__empty">No links in this section.</p>
          ) : (
            rows.map((row, index) => {
              const base = baseRows.find((item) => item.rowId === row.rowId);
              const dirty = base ? isNavDirty(base, row) : false;
              return (
                <NavigationRow
                  key={row.rowId}
                  row={row}
                  index={index}
                  dirty={dirty}
                  readOnly={readOnly}
                  rowProps={getRowProps(index)}
                  handleProps={getHandleProps(index)}
                  onUpdate={onUpdate}
                />
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

interface NavigationRowProps {
  row: NavRow;
  index: number;
  dirty: boolean;
  readOnly: boolean;
  rowProps: ReturnType<ReturnType<typeof useDragReorder>["getRowProps"]>;
  handleProps: ReturnType<ReturnType<typeof useDragReorder>["getHandleProps"]>;
  onUpdate: <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => void;
}

function NavigationRow({
  row,
  dirty,
  readOnly,
  rowProps,
  handleProps,
  onUpdate,
}: NavigationRowProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  return (
    <article
      className="nav-row"
      data-dirty={dirty ? "true" : undefined}
      {...rowProps}
    >
      <button
        type="button"
        className="nav-row__drag"
        disabled={readOnly}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        {...(!readOnly ? handleProps : {})}
      >
        <DragDotsIcon />
      </button>
      <input
        ref={labelRef}
        className="nav-row__label"
        disabled={readOnly}
        value={row.label}
        placeholder="Label"
        onChange={(event) => onUpdate(row.rowId, "label", event.target.value)}
        aria-label="Link label"
      />
      <label
        className="nav-row__enabled"
        title={row.enabled ? "Enabled" : "Hidden"}
      >
        <input
          type="checkbox"
          disabled={readOnly}
          checked={row.enabled}
          onChange={(event) => onUpdate(row.rowId, "enabled", event.target.checked)}
          aria-label={`${row.label || "Link"} enabled`}
        />
        <span className="nav-row__enabled-track" aria-hidden="true">
          <span className="nav-row__enabled-thumb" />
        </span>
      </label>
      <button
        type="button"
        className="nav-row__menu-button"
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        aria-label={`More options for ${row.label || "link"}`}
        title="URL · group"
      >
        <MoreHorizontalIcon />
      </button>
      {menuAnchor ? (
        <NavigationRowMenu
          anchor={menuAnchor}
          row={row}
          readOnly={readOnly}
          onClose={() => setMenuAnchor(null)}
          onUpdate={onUpdate}
        />
      ) : null}
      {dirty ? <span className="nav-row__dirty-dot" aria-hidden="true" /> : null}
    </article>
  );
}

interface NavigationRowMenuProps {
  anchor: HTMLElement;
  row: NavRow;
  readOnly: boolean;
  onClose: () => void;
  onUpdate: <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => void;
}

function NavigationRowMenu({
  anchor,
  row,
  readOnly,
  onClose,
  onUpdate,
}: NavigationRowMenuProps) {
  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Edit navigation link"
      className="nav-row-menu"
      onClose={onClose}
      open
      placement="bottom-end"
    >
      <div className="nav-row-menu__body">
        <label className="nav-row-menu__field">
          <span>URL</span>
          <input
            disabled={readOnly}
            value={row.href}
            placeholder="/path or https://…"
            onChange={(event) => onUpdate(row.rowId, "href", event.target.value)}
          />
        </label>
        <fieldset className="nav-row-menu__group" disabled={readOnly}>
          <legend>Group</legend>
          <label>
            <input
              type="radio"
              name={`nav-row-menu-group-${row.rowId}`}
              checked={row.group === "top"}
              onChange={() => onUpdate(row.rowId, "group", "top")}
            />
            Top bar
          </label>
          <label>
            <input
              type="radio"
              name={`nav-row-menu-group-${row.rowId}`}
              checked={row.group === "more"}
              onChange={() => onUpdate(row.rowId, "group", "more")}
            />
            More menu
          </label>
        </fieldset>
      </div>
    </BlockPopover>
  );
}

// ---------- icons ----------

const ICON_PROPS: { width: number; height: number; viewBox: string } = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
};

function ChevronDown({ collapsed }: { collapsed: boolean }) {
  const style: CSSProperties = {
    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
    transition: "transform 140ms ease",
  };
  return (
    <svg {...ICON_PROPS} aria-hidden="true" focusable="false" style={style}>
      <path
        d="M3.5 6L8 10.5L12.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...ICON_PROPS} aria-hidden="true" focusable="false">
      <path
        d="M8 3.5V12.5 M3.5 8H12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoreHorizontalIcon() {
  return (
    <svg {...ICON_PROPS} aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function DragDotsIcon() {
  // 6-dot grip — same pattern Notion / Super.so use as a drag affordance.
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 10 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="3" cy="3" r="1.1" fill="currentColor" />
      <circle cx="7" cy="3" r="1.1" fill="currentColor" />
      <circle cx="3" cy="8" r="1.1" fill="currentColor" />
      <circle cx="7" cy="8" r="1.1" fill="currentColor" />
      <circle cx="3" cy="13" r="1.1" fill="currentColor" />
      <circle cx="7" cy="13" r="1.1" fill="currentColor" />
    </svg>
  );
}
