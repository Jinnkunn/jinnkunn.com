"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { useUnsavedChangesGuard } from "@/components/site-admin/use-unsaved-changes-guard";
import type { RouteManifestItem } from "@/lib/routes-manifest";
import type { AccessMode } from "@/lib/shared/access";
import { compactId } from "@/lib/shared/route-utils";
import {
  deriveEditorStatus,
  hasRouteAccessDraftChanges,
  hasRouteOverrideDraftChanges,
  IDLE_EDITOR_RESULT,
  type SiteAdminEditorResultState,
} from "@/lib/site-admin/editor-state";
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
  const [loading, setLoading] = useState(false);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [editorResult, setEditorResult] =
    useState<SiteAdminEditorResultState>(IDLE_EDITOR_RESULT);
  const [batchResult, setBatchResult] = useState<{
    kind: "saved" | "conflict" | "error";
    message: string;
  } | null>(null);
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
  const conflictLocked = editorResult.kind === "conflict";
  const clearEditorResultOnEdit = useCallback(() => {
    setEditorResult((prev) =>
      prev.kind === "saved" || prev.kind === "error" ? IDLE_EDITOR_RESULT : prev,
    );
    setBatchResult(null);
  }, []);

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

  const loadLatest = useCallback(
    async (opts?: { resetEditorResult?: boolean }) => {
      setLoading(true);
      setErr("");
      try {
        const parsed = await fetchAdminConfig(items);
        setCfg(parsed);
        setAccessChoice({});
        setOverrideDrafts({});
        setPasswordDrafts({});
        setBatchResult(null);
        if (opts?.resetEditorResult !== false) {
          setEditorResult({
            kind: "idle",
            message: "Latest source loaded from GitHub main.",
          });
        }
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [items, setAccessChoice, setCfg, setErr],
  );

  useEffect(() => {
    void loadLatest({ resetEditorResult: false });
  }, [loadLatest]);

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

  const findEffectiveAccess = useMemo(() => {
    return createEffectiveAccessFinder({ cfg, tree, items });
  }, [cfg, tree, items]);

  const effectiveAccessById = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof findEffectiveAccess>>();
    for (const it of ordered) byId.set(it.id, findEffectiveAccess(it.id, it.routePath));
    return byId;
  }, [findEffectiveAccess, ordered]);

  const draftAwareOverrides = useMemo(() => {
    const next = { ...cfg.overrides };
    for (const [pageId, routePath] of Object.entries(overrideDrafts)) {
      if (!routePath.trim()) {
        delete next[pageId];
        continue;
      }
      next[pageId] = routePath;
    }
    return next;
  }, [cfg.overrides, overrideDrafts]);

  const findOverrideConflict = useMemo(() => {
    return createOverrideConflictFinder({ items, overrides: draftAwareOverrides });
  }, [items, draftAwareOverrides]);

  const routeDraftStateById = useMemo(() => {
    const byId = new Map<
      string,
      {
        overrideInput: string;
        overrideDirty: boolean;
        overrideConflict: ReturnType<typeof findOverrideConflict>;
        directProtected: boolean;
        inheritedProtected: boolean;
        baselineAccess: AccessMode;
        selectedAccess: AccessMode;
        passwordInput: string;
        accessDirty: boolean;
      }
    >();

    for (const it of ordered) {
      const match = effectiveAccessById.get(it.id) || null;
      const compactPageId = compactId(it.id);
      const directProtected = Boolean(cfg.protectedByPageId[compactPageId]);
      const inheritedProtected = Boolean(match) && !directProtected;
      const baselineAccess: AccessMode = inheritedProtected
        ? match?.auth === "github"
          ? "github"
          : "password"
        : directProtected
          ? cfg.protectedByPageId[compactPageId]?.auth === "github"
            ? "github"
            : "password"
          : "public";
      const selectedAccess = accessChoice[it.id] || baselineAccess;
      const passwordInput =
        inheritedProtected || selectedAccess !== "password" ? "" : passwordDrafts[it.id] || "";
      const overrideInput = overrideDrafts[it.id] ?? cfg.overrides[it.id] ?? "";
      const overrideDirty = hasRouteOverrideDraftChanges(
        cfg.overrides[it.id] || "",
        overrideInput,
      );
      const accessDirty = hasRouteAccessDraftChanges({
        inheritedProtected,
        baselineAccess,
        selectedAccess,
        passwordDraft: passwordDrafts[it.id] || "",
      });
      const overrideConflict = overrideInput
        ? findOverrideConflict(it.id, overrideInput)
        : null;

      byId.set(it.id, {
        overrideInput,
        overrideDirty,
        overrideConflict,
        directProtected,
        inheritedProtected,
        baselineAccess,
        selectedAccess,
        passwordInput,
        accessDirty,
      });
    }

    return byId;
  }, [
    accessChoice,
    cfg.overrides,
    cfg.protectedByPageId,
    effectiveAccessById,
    findOverrideConflict,
    ordered,
    overrideDrafts,
    passwordDrafts,
  ]);

  const dirtyRouteCount = useMemo(() => {
    let count = 0;
    for (const stateForRoute of routeDraftStateById.values()) {
      if (stateForRoute.overrideDirty || stateForRoute.accessDirty) count += 1;
    }
    return count;
  }, [routeDraftStateById]);

  const hasUnsavedChanges = dirtyRouteCount > 0;
  const status = deriveEditorStatus({
    hasUnsavedChanges,
    result: editorResult,
    dirtyMessage:
      dirtyRouteCount === 1
        ? "You have unsaved changes on 1 route."
        : `You have unsaved changes on ${dirtyRouteCount} routes.`,
    idleMessage: "No local route changes.",
  });

  const clearDraftsForPageIds = useCallback(
    (pageIds: string[]) => {
      if (!pageIds.length) return;
      setOverrideDrafts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pageId of pageIds) {
          if (!(pageId in next)) continue;
          delete next[pageId];
          changed = true;
        }
        return changed ? next : prev;
      });
      setPasswordDrafts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pageId of pageIds) {
          if (!(pageId in next)) continue;
          delete next[pageId];
          changed = true;
        }
        return changed ? next : prev;
      });
      setAccessChoice((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pageId of pageIds) {
          if (!(pageId in next)) continue;
          delete next[pageId];
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [setAccessChoice],
  );

  const setOverrideDraft = useCallback(
    (pageId: string, value: string) => {
      if (conflictLocked) return;
      clearEditorResultOnEdit();
      setOverrideDrafts((prev) => ({ ...prev, [pageId]: value }));
    },
    [clearEditorResultOnEdit, conflictLocked],
  );

  const setRouteAccessChoice = useCallback(
    (pageId: string, value: AccessMode) => {
      if (conflictLocked) return;
      clearEditorResultOnEdit();
      setAccessChoice((prev) => ({ ...prev, [pageId]: value }));
      if (value !== "password") {
        setPasswordDrafts((prev) => {
          if (!(pageId in prev)) return prev;
          const next = { ...prev };
          delete next[pageId];
          return next;
        });
      }
    },
    [clearEditorResultOnEdit, conflictLocked, setAccessChoice],
  );

  const setRoutePasswordDraft = useCallback(
    (pageId: string, value: string) => {
      if (conflictLocked) return;
      clearEditorResultOnEdit();
      setPasswordDrafts((prev) => ({ ...prev, [pageId]: value }));
    },
    [clearEditorResultOnEdit, conflictLocked],
  );

  const saveOverride = useCallback(
    async (pageId: string) => {
      if (conflictLocked) return;
      setBatchResult(null);
      const routePath = overrideDrafts[pageId] ?? cfg.overrides[pageId] ?? "";
      const saved = await saveRouteOverride(
        {
          setBusyId,
          setErr,
          setCfg,
          setEditorResult,
        },
        cfg.sourceVersion.siteConfigSha,
        pageId,
        routePath,
      );
      if (saved) {
        setOverrideDrafts((prev) => {
          if (!(pageId in prev)) return prev;
          const next = { ...prev };
          delete next[pageId];
          return next;
        });
      }
    },
    [
      cfg.overrides,
      cfg.sourceVersion.siteConfigSha,
      conflictLocked,
      overrideDrafts,
      setBusyId,
      setCfg,
      setErr,
    ],
  );

  const saveAccess = useCallback(
    async ({ pageId, path }: { pageId: string; path: string }) => {
      if (conflictLocked) return;
      const stateForRoute = routeDraftStateById.get(pageId);
      if (!stateForRoute) return;
      setBatchResult(null);
      const result = await applyRouteAccess(
        {
          setBusyId,
          setErr,
          setCfg,
          setEditorResult,
        },
        {
          pageId,
          path,
          access: stateForRoute.selectedAccess,
          password: stateForRoute.passwordInput,
          expectedProtectedRoutesSha: cfg.sourceVersion.protectedRoutesSha,
          trackBusy: true,
          trackEditorResult: true,
        },
      );
      if (result.ok) clearDraftsForPageIds([pageId]);
    },
    [
      cfg.sourceVersion.protectedRoutesSha,
      clearDraftsForPageIds,
      conflictLocked,
      routeDraftStateById,
      setBusyId,
      setCfg,
      setErr,
    ],
  );

  const applyBatchAccess = useCallback(async () => {
    if (batchBusy || conflictLocked) return;
    if (!filtered.length) return;
    setBatchBusy(true);
    setErr("");
    setBatchResult(null);
    setEditorResult({
      kind: "saving",
      message: `Saving access changes for ${filtered.length} routes to GitHub main...`,
    });
    const result = await applyBatchRouteAccess(
      {
        setBusyId,
        setErr,
        setCfg,
        setEditorResult,
      },
      {
        routes: filtered,
        access: batchAccess,
        batchPassword,
        expectedProtectedRoutesSha: cfg.sourceVersion.protectedRoutesSha,
      },
    );
    clearDraftsForPageIds(result.appliedPageIds);

    if (result.interruptedByConflict) {
      const message = `Applied to ${result.success}/${result.total} routes before a source conflict interrupted the batch.`;
      setBatchResult({ kind: "conflict", message });
      setEditorResult({
        kind: "conflict",
        message: `${message} Reload latest before continuing.`,
      });
    } else if (result.errorMessage) {
      const failed = result.total - result.success;
      const message = `Applied to ${result.success}/${result.total} routes. ${failed} failed. ${result.errorMessage}`;
      setBatchResult({ kind: "error", message });
      setEditorResult({
        kind: "error",
        message,
      });
    } else {
      const message = `Applied to ${result.success}/${result.total} routes. Saved to GitHub main. Deploy to publish.`;
      setBatchResult({ kind: "saved", message });
      setEditorResult({
        kind: "saved",
        message,
      });
    }
    setBatchBusy(false);
  }, [
    batchAccess,
    batchBusy,
    batchPassword,
    cfg.sourceVersion.protectedRoutesSha,
    clearDraftsForPageIds,
    conflictLocked,
    filtered,
    setBatchBusy,
    setCfg,
    setErr,
    setBusyId,
  ]);

  useUnsavedChangesGuard({
    enabled: hasUnsavedChanges,
  });

  return {
    q,
    setQ,
    filter,
    setFilter,
    cfg,
    loading,
    busyId,
    err,
    status,
    conflictLocked,
    hasUnsavedChanges,
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
    isSearchActive: Boolean(normalizeSearchQuery(q)),
  };
}
