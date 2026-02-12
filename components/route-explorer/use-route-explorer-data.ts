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

import { fetchAdminConfig, postAccess, postOverride } from "./api";

export function useRouteExplorerData(items: RouteManifestItem[]) {
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const findEffectiveAccess = useMemo(() => {
    return createEffectiveAccessFinder({ cfg, tree, items });
  }, [cfg, tree, items]);

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
    filtered,
    visible,
    findEffectiveAccess,
    toggleCollapsed,
    toggleOpenAdmin,
    collapseAll,
    expandAll,
    saveOverride,
    saveAccess,
    isSearchActive: Boolean(normalizeSearchQuery(q)),
  };
}
