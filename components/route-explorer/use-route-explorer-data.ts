"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

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
  INITIAL_RENDER_LIMIT,
  routeExplorerStateReducer,
} from "./use-route-explorer-state";
import {
  applyBatchRouteAccess,
  applyRouteAccess,
  saveRouteOverride,
} from "./use-route-explorer-mutations";

const COLLAPSED_STORAGE_KEY = "site-admin.routes.collapsed.v2";
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
  const sourceVersionRef = useRef(state.sourceVersion);
  const {
    q,
    filter,
    cfg,
    sourceVersion,
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
    setSourceVersion: setSourceVersionState,
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
    sourceVersionRef.current = sourceVersion;
  }, [sourceVersion]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const parsed = await fetchAdminConfig(items);
        if (!cancelled) {
          setCfg(parsed.config);
          sourceVersionRef.current = parsed.sourceVersion;
          setSourceVersionState(parsed.sourceVersion);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [items, setCfg, setErr, setSourceVersionState]);

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

  const toggleOpenAdmin = useCallback(
    (id: string) => setOpenAdmin((prev) => ({ ...prev, [id]: !prev[id] })),
    [setOpenAdmin],
  );

  // `descendantsOf` depends on the current tree; we capture its latest value
  // through a ref so `toggleCollapsed` itself can stay identity-stable and
  // let the memoized RouteRow skip re-renders on unrelated tree changes.
  // Writing the ref must happen inside an effect (React prohibits mutating
  // refs during render). `toggleCollapsed` is only invoked in event
  // handlers after commit, so the ref is always up-to-date at call time.
  const descendantsRef = useRef(descendantsOf);
  useEffect(() => {
    descendantsRef.current = descendantsOf;
  }, [descendantsOf]);

  const toggleCollapsed = useCallback(
    (id: string) => {
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
        for (const d of descendantsRef.current(id)) next[d] = true;
        return next;
      });
    },
    [setCollapsed],
  );

  const collapseAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const it of ordered) if (it.hasChildren) next[it.id] = true;
    setCollapsed(next);
  }, [ordered, setCollapsed]);

  const expandAll = useCallback(() => setCollapsed({}), [setCollapsed]);

  const saveOverride = useCallback(
    async (pageId: string, routePath: string) =>
      saveRouteOverride(
        {
          setBusyId,
          setErr,
          setCfg,
          getSourceVersion: () => sourceVersionRef.current,
          setSourceVersion: (value) => {
            sourceVersionRef.current = value;
            setSourceVersionState(value);
          },
        },
        pageId,
        routePath,
      ),
    [setBusyId, setErr, setCfg, setSourceVersionState],
  );

  const applyAccess = useCallback(
    async ({
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
          getSourceVersion: () => sourceVersionRef.current,
          setSourceVersion: (value) => {
            sourceVersionRef.current = value;
            setSourceVersionState(value);
          },
        },
        {
          pageId,
          path,
          access,
          password,
          trackBusy,
        },
      ),
    [setBusyId, setErr, setCfg, setSourceVersionState],
  );

  const saveAccess = useCallback(
    async ({
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
    },
    [applyAccess],
  );

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
        getSourceVersion: () => sourceVersionRef.current,
        setSourceVersion: (value) => {
          sourceVersionRef.current = value;
          setSourceVersionState(value);
        },
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
    sourceVersion,
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
