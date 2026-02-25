"use client";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { normalizeAccessMode, type AccessMode } from "@/lib/shared/access";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";

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
    cfg,
    busyId,
    err,
    collapsed,
    openAdmin,
    accessChoice,
    setAccessChoice,
    batchAccess,
    setBatchAccess,
    batchPassword,
    setBatchPassword,
    batchBusy,
    applyBatchAccess,
    filtered,
    visible,
    renderedVisible,
    hasMoreVisible,
    showMoreVisible,
    findEffectiveAccess,
    findOverrideConflict,
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
            Auto-generated from your content source on deploy. Edit overrides/protection here, then Deploy.
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
                onChange={(e) => setBatchPassword(e.target.value)}
              />
            ) : null}
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={batchBusy || filtered.length === 0 || (batchAccess === "password" && !batchPassword)}
              onClick={() => void applyBatchAccess()}
              title="Apply to current filtered routes"
            >
              {batchBusy ? "Applying..." : `Apply (${filtered.length})`}
            </button>
          </div>
        </div>
      </div>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

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
          const directProtected = Boolean(cfg.protectedByPageId[compactId(it.id)]);
          const effectiveProtected = Boolean(match);
          const inheritedProtected = effectiveProtected && !directProtected;
          const adminOpen = Boolean(openAdmin[it.id]);
          const overrideValue = cfg.overrides[it.id] || "";
          const overridePending =
            Boolean(overrideValue) && normalizeRoutePath(overrideValue) !== normalizeRoutePath(it.routePath);
          const overrideConflict = overrideValue ? findOverrideConflict(it.id, overrideValue) : null;
          return (
            <RouteRow
              key={it.id}
              it={it}
              cfg={cfg}
              collapsed={collapsed}
              adminOpen={adminOpen}
              busy={busyId === it.id}
              accessChoice={accessChoice}
              effectiveAccess={match}
              inheritedProtected={inheritedProtected}
              directProtected={directProtected}
              overrideValue={overrideValue}
              overridePending={overridePending}
              overrideConflict={overrideConflict}
              getOverrideConflict={(candidatePath) => findOverrideConflict(it.id, candidatePath)}
              onToggleCollapsed={toggleCollapsed}
              onToggleAdmin={toggleOpenAdmin}
              onSetAccessChoice={(id, v) =>
                setAccessChoice((prev) => ({
                  ...prev,
                  [id]: v,
                }))
              }
              onSaveOverride={(id, v) => void saveOverride(id, v)}
              onSaveAccess={(input) =>
                void saveAccess({
                  pageId: input.pageId,
                  path: input.path,
                  access: input.access,
                  password: input.password,
                })
              }
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
