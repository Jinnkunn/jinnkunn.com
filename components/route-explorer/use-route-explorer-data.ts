"use client";

import { useEffect, useMemo, useState } from "react";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import {
  type AdminConfig,
  buildDescendantsGetter,
  buildRouteTree,
  computeVisibleRoutes,
  createEffectiveAccessFinder,
  createOverrideConflictFinder,
  filterOrderedRoutes,
  getDefaultCollapsed,
  normalizeSearchQuery,
} from "@/lib/site-admin/route-explorer-model";

import { fetchAdminConfig, postAccess, postOverride } from "./api";

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
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "nav" | "overrides">("all");
  const [cfg, setCfg] = useState<AdminConfig>({
    overrides: {},
    protectedByPageId: {},
  });
  const [busyId, setBusyId] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openAdmin, setOpenAdmin] = useState<Record<string, boolean>>({});
  const [accessChoice, setAccessChoice] = useState<Record<string, "public" | "password" | "github">>(
    {},
  );
  const [batchAccess, setBatchAccess] = useState<"public" | "password" | "github">("public");
  const [batchPassword, setBatchPassword] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [collapsedReady, setCollapsedReady] = useState(false);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);

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
  }, [items]);

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
  }, [ordered, collapsedReady]);

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
  }, [q, filter]);

  useEffect(() => {
    setRenderLimit((prev) => {
      if (visible.length >= prev) return prev;
      if (visible.length <= INITIAL_RENDER_LIMIT) return INITIAL_RENDER_LIMIT;
      if (visible.length <= 0) return INITIAL_RENDER_LIMIT;
      return visible.length;
    });
  }, [visible.length]);

  useEffect(() => {
    if (!collapsedReady) return;
    if (!q.trim()) return;
    setRenderLimit((prev) => {
      if (visible.length <= prev) return prev;
      // Search should feel immediate even on deep trees.
      return Math.min(visible.length, Math.max(prev, 500));
    });
  }, [collapsedReady, q, visible.length]);

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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const applyAccess = async ({
    pageId,
    path,
    access,
    password,
    trackBusy,
  }: {
    pageId: string;
    path: string;
    access: "public" | "password" | "github";
    password?: string;
    trackBusy: boolean;
  }): Promise<boolean> => {
    if (trackBusy) setBusyId(pageId);
    setErr("");
    try {
      await postAccess({ pageId, path, access, password });

      setCfg((prev) => {
        const next: AdminConfig = {
          overrides: prev.overrides,
          protectedByPageId: { ...prev.protectedByPageId },
        };
        const pid = compactId(pageId);
        const p = normalizeRoutePath(path) || "/";

        // Public means remove any direct protection for this page.
        if (access === "public") {
          delete next.protectedByPageId[pid];
          return next;
        }

        if (!pid) return next;
        const auth: "password" | "github" = access === "github" ? "github" : "password";
        next.protectedByPageId[pid] = { auth, mode: "prefix", path: p };
        return next;
      });
      return true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      if (trackBusy) setBusyId("");
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
    await applyAccess({ pageId, path, access, password, trackBusy: true });
  };

  const applyBatchAccess = async () => {
    if (batchBusy) return;
    if (!filtered.length) return;
    setBatchBusy(true);
    setErr("");
    const auth = batchAccess;
    const password = auth === "password" ? batchPassword : "";
    let success = 0;
    for (const it of filtered) {
      const ok = await applyAccess({
        pageId: it.id,
        path: it.routePath,
        access: auth,
        password,
        trackBusy: false,
      });
      if (ok) success += 1;
    }
    if (success !== filtered.length) {
      setErr(`Batch applied to ${success}/${filtered.length} routes.`);
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
