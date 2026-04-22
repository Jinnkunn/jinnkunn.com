"use client";

import { SiteAdminEditorStatusBar } from "@/components/site-admin/editor-status-bar";
import type { RouteManifestItem } from "@/lib/routes-manifest";
import { normalizeAccessMode, type AccessMode } from "@/lib/shared/access";
import { normalizeRoutePath } from "@/lib/shared/route-utils";

import { RouteRow } from "./route-explorer/route-row";
import { useRouteExplorerData } from "./route-explorer/use-route-explorer-data";
import { cn } from "./route-explorer/utils";

export default function RouteExplorer({
  items,
}: {
  items: RouteManifestItem[];
}) {
  const {
    q,
    setQ,
    filter,
    setFilter,
    loading,
    busyId,
    err,
    status,
    conflictLocked,
    loadLatest,
    collapsed,
    openAdmin,
    routeDraftStateById,
    setOverrideDraft,
    setRouteAccessChoice,
    setRoutePasswordDraft,
    batchAccess,
    setBatchAccess,
    batchPassword,
    setBatchPassword,
    batchBusy,
    batchResult,
    applyBatchAccess,
    filtered,
    visible,
    renderedVisible,
    hasMoreVisible,
    showMoreVisible,
    findEffectiveAccess,
    toggleCollapsed,
    toggleOpenAdmin,
    collapseAll,
    expandAll,
    saveOverride,
    saveAccess,
    isSearchActive,
  } = useRouteExplorerData(items);

  return (
    <div className="routes-explorer">
      <div className="routes-explorer__header">
        <div className="routes-explorer__title">
          <h1 className="routes-explorer__h1">Routes</h1>
          <p className="routes-explorer__sub">
            Save writes route overrides and protection rules to GitHub main. Deploy publishes those saved changes to the live site.
          </p>
        </div>

        <div className="routes-explorer__controls">
          <label className="routes-explorer__search">
            <span className="sr-only">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, route, page id..."
              className="routes-explorer__input"
              inputMode="search"
            />
          </label>

          <div className="routes-explorer__filter" role="group" aria-label="Route filters">
            {(
              [
                { id: "all", label: "All" },
                { id: "nav", label: "Nav" },
                { id: "overrides", label: "Overrides" },
              ] as const
            ).map((it) => (
              <button
                key={it.id}
                type="button"
                className={cn(
                  "routes-explorer__filter-btn",
                  filter === it.id ? "is-active" : "",
                )}
                onClick={() => setFilter(it.id)}
              >
                {it.label}
              </button>
            ))}
          </div>

          <div className="routes-explorer__filter" role="group" aria-label="Tree controls">
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={expandAll}
              disabled={isSearchActive}
              title={
                isSearchActive ? "Clear search to use tree folding" : "Expand all"
              }
            >
              Expand
            </button>
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={collapseAll}
              disabled={isSearchActive}
              title={
                isSearchActive ? "Clear search to use tree folding" : "Collapse all"
              }
            >
              Collapse
            </button>
          </div>

          <div className="routes-explorer__batch" role="group" aria-label="Batch access">
            <select
              className="routes-explorer__admin-select"
              value={batchAccess}
              disabled={batchBusy || conflictLocked}
              onChange={(e) => {
                const next: AccessMode = normalizeAccessMode(e.target.value, "public");
                setBatchAccess(next);
              }}
            >
              <option value="public">Batch: public</option>
              <option value="password">Batch: password</option>
              <option value="github">Batch: github</option>
            </select>
            {batchAccess === "password" ? (
              <input
                className="routes-explorer__admin-input"
                type="password"
                value={batchPassword}
                placeholder="Password"
                disabled={batchBusy || conflictLocked}
                onChange={(e) => setBatchPassword(e.target.value)}
              />
            ) : null}
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={
                batchBusy ||
                conflictLocked ||
                filtered.length === 0 ||
                (batchAccess === "password" && !batchPassword)
              }
              onClick={() => void applyBatchAccess()}
              title="Apply to current filtered routes"
            >
              {batchBusy ? "Applying..." : `Apply (${filtered.length})`}
            </button>
          </div>
        </div>
      </div>

      <SiteAdminEditorStatusBar
        status={status}
        busy={loading || batchBusy || Boolean(busyId)}
        canReload={conflictLocked}
        onReload={() => void loadLatest()}
      />

      {err ? <div className="routes-explorer__error">{err}</div> : null}
      {batchResult ? (
        <div
          className={cn(
            "routes-explorer__batch-result",
            `routes-explorer__batch-result--${batchResult.kind}`,
          )}
        >
          {batchResult.message}
        </div>
      ) : null}

      <div className="routes-explorer__meta">
        <span className="routes-explorer__count">{filtered.length}</span>
        <span className="routes-explorer__count-label">routes</span>
        {renderedVisible.length < visible.length ? (
          <span className="routes-explorer__count-label">
            (showing {renderedVisible.length}/{visible.length})
          </span>
        ) : null}
      </div>

      <div className="routes-tree" role="list" aria-label="Routes">
        {renderedVisible.map((it) => {
          const match = findEffectiveAccess(it.id, it.routePath);
          const adminOpen = Boolean(openAdmin[it.id]);
          const routeState = routeDraftStateById.get(it.id);
          const overrideValue = routeState?.overrideInput || "";
          const overridePending =
            Boolean(overrideValue) &&
            normalizeRoutePath(overrideValue) !== normalizeRoutePath(it.routePath);
          return (
            <RouteRow
              key={it.id}
              it={it}
              collapsed={collapsed}
              adminOpen={adminOpen}
              busy={busyId === it.id}
              effectiveAccess={match}
              inheritedProtected={routeState?.inheritedProtected || false}
              directProtected={routeState?.directProtected || false}
              overrideValue={overrideValue}
              overrideDirty={routeState?.overrideDirty || false}
              overridePending={overridePending}
              accessPending={routeState?.accessDirty || false}
              overrideConflict={routeState?.overrideConflict || null}
              selectedAccess={routeState?.selectedAccess || "public"}
              passwordValue={routeState?.passwordInput || ""}
              conflictLocked={conflictLocked}
              onToggleCollapsed={toggleCollapsed}
              onToggleAdmin={toggleOpenAdmin}
              onSetOverrideValue={setOverrideDraft}
              onSetAccessChoice={setRouteAccessChoice}
              onSetPasswordValue={setRoutePasswordDraft}
              onSaveOverride={(id) => void saveOverride(id)}
              onSaveAccess={(input) => void saveAccess(input)}
            />
          );
        })}
      </div>
      {hasMoreVisible ? (
        <div className="routes-explorer__more">
          <button type="button" className="routes-explorer__filter-btn" onClick={showMoreVisible}>
            Load more ({visible.length - renderedVisible.length} remaining)
          </button>
        </div>
      ) : null}
    </div>
  );
}
