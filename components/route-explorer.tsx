"use client";

import { useEffect, useMemo, useState } from "react";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils.mjs";
import {
  type AdminConfig,
  buildDescendantsGetter,
  buildRouteTree,
  computeVisibleRoutes,
  createEffectiveAccessFinder,
  filterOrderedRoutes,
  getDefaultCollapsed,
  normalizeSearchQuery,
} from "@/lib/site-admin/route-explorer-model";

import { fetchAdminConfig, postAccess, postOverride } from "./route-explorer/api";
import { RouteRow } from "./route-explorer/route-row";
import { cn } from "./route-explorer/utils";

export default function RouteExplorer({
  items,
}: {
  items: RouteManifestItem[];
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "nav" | "overrides">("all");
  const [cfg, setCfg] = useState<AdminConfig>({
    overrides: {},
    protectedByPageId: {},
    protectedByPath: {},
  });
  const [busyId, setBusyId] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openAdmin, setOpenAdmin] = useState<Record<string, boolean>>({});
  const [accessChoice, setAccessChoice] = useState<Record<string, "public" | "password" | "github">>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const parsed = await fetchAdminConfig(items);
        if (!cancelled) setCfg(parsed);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const tree = useMemo(() => buildRouteTree(items), [items]);
  const ordered = tree.ordered;

  // Default: only show root + one level (Super-like). Deeper folders start collapsed.
  useEffect(() => {
    if (Object.keys(collapsed).length > 0) return;
    setCollapsed(getDefaultCollapsed(ordered));
  }, [ordered, collapsed]);

  const filtered = useMemo(() => {
    return filterOrderedRoutes(ordered, q, filter);
  }, [ordered, q, filter]);

  const descendantsOf = useMemo(() => {
    return buildDescendantsGetter(tree.childrenById);
  }, [tree.childrenById]);

  const visible = useMemo(() => {
    return computeVisibleRoutes({
      filtered,
      collapsed,
      q,
      parentById: tree.parentById,
    });
  }, [filtered, collapsed, q, tree.parentById]);

  const toggleOpenAdmin = (id: string) =>
    setOpenAdmin((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev };
      const currentlyCollapsed = Boolean(prev[id]);
      if (currentlyCollapsed) {
        // Expand: only expand this node (leave descendants collapsed).
        delete next[id];
        return next;
      }

      // Collapse: collapse this node AND its subtree so re-expanding doesn't
      // unexpectedly show deep levels (Super-like).
      next[id] = true;
      for (const d of descendantsOf(id)) next[d] = true;
      return next;
    });
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const it of ordered) if (it.hasChildren) next[it.id] = true;
    setCollapsed(next);
  };

  const expandAll = () => setCollapsed({});

  const saveOverride = async (pageId: string, routePath: string) => {
    setBusyId(pageId);
    setErr("");
    try {
      await postOverride({ pageId, routePath });

      setCfg((prev) => {
        const next = { ...prev, overrides: { ...prev.overrides } };
        const normalized = normalizeRoutePath(routePath);
        if (!normalized) delete next.overrides[pageId];
        else next.overrides[pageId] = normalized;
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  const saveAccess = async ({
    pageId,
    path,
    access,
    password,
  }: {
    pageId: string;
    path: string;
    access: "public" | "password" | "github";
    password?: string;
  }) => {
    setBusyId(pageId);
    setErr("");
    try {
      await postAccess({ pageId, path, access, password });

      setCfg((prev) => {
        const next: AdminConfig = {
          overrides: prev.overrides,
          protectedByPageId: { ...prev.protectedByPageId },
          protectedByPath: { ...prev.protectedByPath },
        };
        const pid = compactId(pageId);
        const p = normalizeRoutePath(path);

        // Public means remove any direct protection for this page.
        if (access === "public") {
          delete next.protectedByPageId[pid];
          if (p) delete next.protectedByPath[p];
          return next;
        }

        if (!pid) return next;
        const auth: "password" | "github" = access === "github" ? "github" : "password";
        next.protectedByPageId[pid] = { auth, mode: "prefix", path: p };
        if (p) delete next.protectedByPath[p];
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  const findEffectiveAccess = useMemo(() => {
    return createEffectiveAccessFinder({ cfg, tree, items });
  }, [cfg, tree, items]);

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
              disabled={Boolean(normalizeSearchQuery(q))}
              title={
                normalizeSearchQuery(q) ? "Clear search to use tree folding" : "Expand all"
              }
            >
              Expand
            </button>
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={collapseAll}
              disabled={Boolean(normalizeSearchQuery(q))}
              title={
                normalizeSearchQuery(q) ? "Clear search to use tree folding" : "Collapse all"
              }
            >
              Collapse
            </button>
          </div>
        </div>
      </div>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

      <div className="routes-explorer__meta">
        <span className="routes-explorer__count">{filtered.length}</span>
        <span className="routes-explorer__count-label">routes</span>
      </div>

      <div className="routes-tree" role="list" aria-label="Routes">
        {visible.map((it) => {
          const match = findEffectiveAccess(it.id, it.routePath);
          const directProtected = Boolean(cfg.protectedByPageId[compactId(it.id)]);
          const effectiveProtected = Boolean(match);
          const inheritedProtected = effectiveProtected && !directProtected;
          const adminOpen = Boolean(openAdmin[it.id]);
          const overrideValue = cfg.overrides[it.id] || "";
          const overridePending =
            Boolean(overrideValue) && normalizeRoutePath(overrideValue) !== normalizeRoutePath(it.routePath);
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
              onToggleCollapsed={toggleCollapsed}
              onToggleAdmin={(id) => toggleOpenAdmin(id)}
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
    </div>
  );
}
