"use client";

import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusNotice } from "@/components/ui/status-notice";
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

  // Hoist the per-row callbacks to stable parent-scoped closures so the
  // memoized RouteRow only re-renders when its own row-scoped inputs
  // actually change. Without this, every keystroke in the search box would
  // rebuild each row's `onSetAccessChoice`/`onSaveOverride`/... closures
  // and defeat `React.memo`.
  const handleSetAccessChoice = useCallback(
    (id: string, v: AccessMode) => {
      setAccessChoice((prev) => ({ ...prev, [id]: v }));
    },
    [setAccessChoice],
  );

  const handleSaveOverride = useCallback(
    (id: string, v: string) => void saveOverride(id, v),
    [saveOverride],
  );

  const handleSaveAccess = useCallback(
    (input: { pageId: string; path: string; access: AccessMode; password?: string }) =>
      void saveAccess(input),
    [saveAccess],
  );

  return (
    <div className="routes-explorer">
      <div className="routes-explorer__header">
        <SectionHeader
          className="routes-explorer__title"
          title="Routes"
          description="Auto-generated from your content source on deploy. Edit overrides and protection here, then Deploy."
        />

        <div className="routes-explorer__controls">
          <label className="routes-explorer__search">
            <span className="sr-only">Search</span>
            <Field
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, route, page id..."
              className="routes-explorer__input"
              inputMode="search"
              type="search"
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
              <Button
                key={it.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "routes-explorer__filter-btn",
                  filter === it.id ? "is-active" : "",
                )}
                onClick={() => setFilter(it.id)}
              >
                {it.label}
              </Button>
            ))}
          </div>

          <div className="routes-explorer__filter" role="group" aria-label="Tree controls">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="routes-explorer__filter-btn"
              onClick={expandAll}
              disabled={isSearchActive}
              title={
                isSearchActive ? "Clear search to use tree folding" : "Expand all"
              }
            >
              Expand
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="routes-explorer__filter-btn"
              onClick={collapseAll}
              disabled={isSearchActive}
              title={
                isSearchActive ? "Clear search to use tree folding" : "Collapse all"
              }
            >
              Collapse
            </Button>
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
              <Field
                className="routes-explorer__admin-input"
                type="password"
                value={batchPassword}
                placeholder="Password"
                onChange={(e) => setBatchPassword(e.target.value)}
              />
            ) : null}
            <Button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={batchBusy || filtered.length === 0 || (batchAccess === "password" && !batchPassword)}
              onClick={() => void applyBatchAccess()}
              title="Apply to current filtered routes"
            >
              {batchBusy ? "Applying..." : `Apply (${filtered.length})`}
            </Button>
          </div>
        </div>
      </div>

      {err ? <StatusNotice className="routes-explorer__error" tone="danger">{err}</StatusNotice> : null}

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
              isCollapsed={Boolean(collapsed[it.id])}
              adminOpen={adminOpen}
              busy={busyId === it.id}
              selectedAccessChoice={accessChoice[it.id]}
              effectiveAccess={match}
              inheritedProtected={inheritedProtected}
              directProtected={directProtected}
              overrideValue={overrideValue}
              overridePending={overridePending}
              overrideConflict={overrideConflict}
              findOverrideConflict={findOverrideConflict}
              onToggleCollapsed={toggleCollapsed}
              onToggleAdmin={toggleOpenAdmin}
              onSetAccessChoice={handleSetAccessChoice}
              onSaveOverride={handleSaveOverride}
              onSaveAccess={handleSaveAccess}
            />
          );
        })}
      </div>
      {hasMoreVisible ? (
        <div className="routes-explorer__more">
          <Button type="button" variant="ghost" size="sm" className="routes-explorer__filter-btn" onClick={showMoreVisible}>
            Load more ({visible.length - renderedVisible.length} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
