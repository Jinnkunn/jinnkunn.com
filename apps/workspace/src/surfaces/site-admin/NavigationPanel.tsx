import { useCallback, useEffect, useMemo, useState } from "react";

import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { useSiteAdmin } from "./state";
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

type NewNavDraft = {
  label: string;
  href: string;
  group: "top" | "more";
  enabled: boolean;
};

const BLANK_NEW_NAV: NewNavDraft = {
  label: "",
  href: "",
  group: "top",
  enabled: true,
};

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

function sortedRows(rows: NavRow[], drafts: Record<string, NavRow>, group: "top" | "more") {
  return rows
    .map((row) => drafts[row.rowId] ?? row)
    .filter((row) => row.group === group)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function NavigationPanel() {
  const { productionReadOnly, request, setMessage } = useSiteAdmin();
  const [sourceVersion, setSourceVersion] = useState<ConfigSourceVersion | null>(null);
  const [baseRows, setBaseRows] = useState<NavRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, NavRow>>({});
  const [newNav, setNewNav] = useState<NewNavDraft>(BLANK_NEW_NAV);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [conflict, setConflict] = useState(false);

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

  const moveRow = useCallback(
    (rowId: string, direction: "up" | "down") => {
      setDrafts((prev) => {
        const target = prev[rowId];
        if (!target) return prev;
        const rows = sortedRows(baseRows, prev, target.group);
        const from = rows.findIndex((row) => row.rowId === rowId);
        const to = direction === "up" ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= rows.length) return prev;
        const nextRows = rows.slice();
        [nextRows[from], nextRows[to]] = [nextRows[to], nextRows[from]];
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

  const createNavRow = useCallback(async () => {
    if (productionReadOnly) {
      setMessage("warn", productionReadOnlyMessage("create navigation rows"));
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Navigation sourceVersion missing. Reload latest first.");
      return;
    }
    if (!newNav.label.trim() || !newNav.href.trim()) {
      setMessage("error", "New navigation item needs both label and URL.");
      return;
    }
    const groupRows = sortedRows(baseRows, drafts, newNav.group);
    const nextOrder = groupRows.length
      ? Math.max(...groupRows.map((row) => row.order)) + 10
      : 10;
    setCreating(true);
    const response = await request("/api/site-admin/config", "POST", {
      kind: "nav-create",
      input: { ...newNav, order: nextOrder },
      expectedSiteConfigSha: sourceVersion.siteConfigSha,
    });
    setCreating(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage("warn", "Create navigation item failed with SOURCE_CONFLICT. Reload latest and apply your edit again.");
        return;
      }
      setMessage("error", `Create navigation item failed: ${response.code}: ${response.error}`);
      return;
    }
    setNewNav(BLANK_NEW_NAV);
    setMessage("success", "Navigation item created. Publish staging separately.");
    await loadConfig({ silent: true });
  }, [baseRows, drafts, loadConfig, newNav, productionReadOnly, request, setMessage, sourceVersion]);

  return (
    <section className="surface-card navigation-editor">
      <header className="navigation-editor__header">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Navigation
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Header links for the public site. Reorder visually, then save once.
          </p>
        </div>
        <div className="navigation-editor__actions">
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
      <p className="m-0 text-[12px] text-text-muted">
        {sourceVersion
          ? `sourceVersion.siteConfigSha=${sourceVersion.siteConfigSha} | dirty=${dirtyRows.length}`
          : "Navigation not loaded."}
      </p>

      <section className="navigation-editor__create" aria-label="Add navigation item">
        <input
          disabled={productionReadOnly}
          placeholder="Label"
          value={newNav.label}
          onChange={(e) => setNewNav({ ...newNav, label: e.target.value })}
        />
        <input
          disabled={productionReadOnly}
          placeholder="/path or https://..."
          value={newNav.href}
          onChange={(e) => setNewNav({ ...newNav, href: e.target.value })}
        />
        <select
          disabled={productionReadOnly}
          value={newNav.group}
          onChange={(e) =>
            setNewNav({ ...newNav, group: e.target.value === "more" ? "more" : "top" })
          }
        >
          <option value="top">Top bar</option>
          <option value="more">More menu</option>
        </select>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => void createNavRow()}
          disabled={productionReadOnly || creating || loading || !sourceVersion}
        >
          {creating ? "Adding..." : "Add link"}
        </button>
      </section>

      <NavigationGroup
        title="Top bar"
        rows={topRows}
        baseRows={baseRows}
        readOnly={productionReadOnly}
        onMove={moveRow}
        onUpdate={updateDraft}
      />
      <NavigationGroup
        title="More menu"
        rows={moreRows}
        baseRows={baseRows}
        readOnly={productionReadOnly}
        onMove={moveRow}
        onUpdate={updateDraft}
      />
    </section>
  );
}

function NavigationGroup({
  title,
  rows,
  baseRows,
  readOnly,
  onMove,
  onUpdate,
}: {
  title: string;
  rows: NavRow[];
  baseRows: NavRow[];
  readOnly: boolean;
  onMove: (rowId: string, direction: "up" | "down") => void;
  onUpdate: <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => void;
}) {
  return (
    <section className="navigation-editor__group">
      <header>
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </header>
      <div className="navigation-editor__list">
        {rows.length === 0 ? (
          <p className="empty-note">No links in this section.</p>
        ) : (
          rows.map((row, index) => {
            const base = baseRows.find((item) => item.rowId === row.rowId);
            const dirty = base ? isNavDirty(base, row) : false;
            return (
              <article className="navigation-editor__row" key={row.rowId} data-dirty={dirty ? "true" : "false"}>
                <div className="navigation-editor__order">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={readOnly || index === 0}
                    onClick={() => onMove(row.rowId, "up")}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={readOnly || index === rows.length - 1}
                    onClick={() => onMove(row.rowId, "down")}
                  >
                    Down
                  </button>
                </div>
                <div className="navigation-editor__fields">
                  <input
                    disabled={readOnly}
                    value={row.label}
                    placeholder="Label"
                    onChange={(e) => onUpdate(row.rowId, "label", e.target.value)}
                  />
                  <input
                    disabled={readOnly}
                    value={row.href}
                    placeholder="/path"
                    onChange={(e) => onUpdate(row.rowId, "href", e.target.value)}
                  />
                  <select
                    disabled={readOnly}
                    value={row.group}
                    onChange={(e) =>
                      onUpdate(row.rowId, "group", e.target.value === "more" ? "more" : "top")
                    }
                  >
                    <option value="top">Top bar</option>
                    <option value="more">More menu</option>
                  </select>
                </div>
                <label className="navigation-editor__enabled">
                  <input
                    disabled={readOnly}
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => onUpdate(row.rowId, "enabled", e.target.checked)}
                  />
                  Enabled
                </label>
                <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                  {dirty ? "unsaved" : "saved"}
                </span>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
