"use client";

import { useEffect, useMemo, useReducer } from "react";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import type { AccessMode } from "@/lib/shared/access";
import {
  buildDescendantsGetter,
  buildRouteTree,
  computeVisibleRoutes,
  createEffectiveAccessFinder,
  createOverrideConflictFinder,
  filterOrderedRoutes,
  getDefaultCollapsed,
  normalizeSearchQuery,
} from "@/lib/site-admin/route-explorer-model";

import { fetchAdminConfig } from "./api";
import {
  bindRouteExplorerSetters,
  createRouteExplorerInitialState,
  routeExplorerStateReducer,
} from "./use-route-explorer-state";
import {
  applyBatchRouteAccess,
  applyRouteAccess,
  saveRouteOverride,
} from "./use-route-explorer-mutations";

const COLLAPSED_STORAGE_KEY = "site-admin.routes.collapsed.v2";
const INITIAL_RENDER_LIMIT = 180;
const RENDER_STEP = 180;

function parseStoredCollapsed(
  raw: string,
  validIds: Set<string>,
): Record<string, boolean> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, boolean> = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (!validIds.has(id)) continue;
      if (!v) continue;
      out[id] = true;
    }
    return out;
  } catch {
    return null;
  }
}

export function useRouteExplorerData(items: RouteManifestItem[]) {
  const [state, dispatch] = useReducer(
    routeExplorerStateReducer,
    createRouteExplorerInitialState(),
  );
  const {
    q,
    filter,
    cfg,
    busyId,
    err,
    collapsed,
    openAdmin,
    accessChoice,
    batchAccess,
    batchPassword,
    batchBusy,
    collapsedReady,
    renderLimit,
  } = state;
  const setters = useMemo(() => bindRouteExplorerSetters(dispatch), [dispatch]);
  const {
    setQ,
    setFilter,
    setCfg,
    setBusyId,
    setErr,
    setCollapsed,
    setOpenAdmin,
    setAccessChoice,
    setBatchAccess,
    setBatchPassword,
    setBatchBusy,
    setCollapsedReady,
    setRenderLimit,
  } = setters;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const parsed = await fetchAdminConfig(items);
        if (!cancelled) setCfg(parsed);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [items, setCfg, setErr]);

  const tree = useMemo(() => buildRouteTree(items), [items]);
  const ordered = tree.ordered;

  // Default: only show root + one level (Super-like). Deeper folders start collapsed.
  // Persist collapse preference per browser to keep admin navigation stable.
  useEffect(() => {
    if (collapsedReady) return;
    const fallback = getDefaultCollapsed(ordered);
    if (typeof window === "undefined") {
      setCollapsed(fallback);
      setCollapsedReady(true);
      return;
    }
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) {
      setCollapsed(fallback);
      setCollapsedReady(true);
      return;
    }
    const parsed = parseStoredCollapsed(
      raw,
      new Set(ordered.map((it) => it.id)),
    );
    setCollapsed(parsed ?? fallback);
    setCollapsedReady(true);
  }, [ordered, collapsedReady, setCollapsed, setCollapsedReady]);

  useEffect(() => {
    if (!collapsedReady) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // ignore browser storage errors
    }
  }, [collapsedReady, collapsed]);

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

  useEffect(() => {
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [q, filter, setRenderLimit]);

  useEffect(() => {
    setRenderLimit((prev) => {
      if (visible.length >= prev) return prev;
      if (visible.length <= INITIAL_RENDER_LIMIT) return INITIAL_RENDER_LIMIT;
      if (visible.length <= 0) return INITIAL_RENDER_LIMIT;
      return visible.length;
    });
  }, [visible.length, setRenderLimit]);

  useEffect(() => {
    if (!collapsedReady) return;
    if (!q.trim()) return;
    setRenderLimit((prev) => {
      if (visible.length <= prev) return prev;
      // Search should feel immediate even on deep trees.
      return Math.min(visible.length, Math.max(prev, 500));
    });
  }, [collapsedReady, q, visible.length, setRenderLimit]);

  const renderedVisible = useMemo(() => {
    if (visible.length <= renderLimit) return visible;
    return visible.slice(0, renderLimit);
  }, [visible, renderLimit]);

  const hasMoreVisible = renderedVisible.length < visible.length;

  const showMoreVisible = () => {
    setRenderLimit((prev) => {
      const next = prev + RENDER_STEP;
      if (next >= visible.length) return visible.length;
      return next;
    });
  };

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

  const saveOverride = async (pageId: string, routePath: string) =>
    saveRouteOverride(
      {
        setBusyId,
        setErr,
        setCfg,
      },
      pageId,
      routePath,
    );

  const applyAccess = async ({
    pageId,
    path,
    access,
    password,
    trackBusy,
  }: {
    pageId: string;
    path: string;
    access: AccessMode;
    password?: string;
    trackBusy: boolean;
  }) =>
    applyRouteAccess(
      {
        setBusyId,
        setErr,
        setCfg,
      },
      {
        pageId,
        path,
        access,
        password,
        trackBusy,
      },
    );

  const saveAccess = async ({
    pageId,
    path,
    access,
    password,
  }: {
    pageId: string;
    path: string;
    access: AccessMode;
    password?: string;
  }) => {
    await applyAccess({ pageId, path, access, password, trackBusy: true });
  };

  const applyBatchAccess = async () => {
    if (batchBusy) return;
    if (!filtered.length) return;
    setBatchBusy(true);
    setErr("");
    const { success, total } = await applyBatchRouteAccess(
      {
        setBusyId,
        setErr,
        setCfg,
      },
      {
        routes: filtered,
        access: batchAccess,
        batchPassword,
      },
    );
    if (success !== total) {
      setErr(`Batch applied to ${success}/${total} routes.`);
    }
    setBatchBusy(false);
  };

  const findEffectiveAccess = useMemo(() => {
    return createEffectiveAccessFinder({ cfg, tree, items });
  }, [cfg, tree, items]);

  const findOverrideConflict = useMemo(() => {
    return createOverrideConflictFinder({ items, overrides: cfg.overrides });
  }, [items, cfg.overrides]);

  return {
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
    isSearchActive: Boolean(normalizeSearchQuery(q)),
  };
}
