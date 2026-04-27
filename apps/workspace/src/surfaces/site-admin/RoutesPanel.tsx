import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BLANK_NEW_OVERRIDE,
  OverridesSection,
  type NewOverrideInput,
} from "./routes/OverridesSection";
import {
  BLANK_NEW_PROTECTED,
  ProtectedSection,
  type NewProtectedInput,
  validateProtected,
} from "./routes/ProtectedSection";
import { RedirectsSection } from "./routes/RedirectsSection";
import { useSiteAdmin } from "./state";
import type {
  OverrideRow,
  ProtectedRow,
  RoutesSourceVersion,
} from "./types";
import {
  clone,
  isProductionSiteAdminConnection,
  isOverrideDirty,
  isProtectedDirty,
  normalizeOverride,
  normalizeProtected,
  normalizeString,
} from "./utils";

/** Orchestrator for the Routes surface: owns load/save state + conflict
 * handling. The two visual sections (Route Overrides, Protected Routes)
 * each render their own table + create-form via components under
 * `routes/`. */
export function RoutesPanel() {
  const { connection, request, setMessage } = useSiteAdmin();

  const [sourceVersion, setSourceVersion] = useState<RoutesSourceVersion | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, OverrideRow>>({});
  const [overrideSaving, setOverrideSaving] = useState<Record<string, boolean>>({});
  const [protectedRows, setProtectedRows] = useState<ProtectedRow[]>([]);
  const [protectedDrafts, setProtectedDrafts] = useState<Record<string, ProtectedRow>>({});
  const [protectedSaving, setProtectedSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [creatingOverride, setCreatingOverride] = useState(false);
  const [creatingProtected, setCreatingProtected] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [newOverride, setNewOverride] = useState<NewOverrideInput>(BLANK_NEW_OVERRIDE);
  const [newProtected, setNewProtected] = useState<NewProtectedInput>(BLANK_NEW_PROTECTED);
  const [redirects, setRedirects] = useState<{
    pages: Record<string, string>;
    posts: Record<string, string>;
  }>({ pages: {}, posts: {} });
  const [redirectsLoading, setRedirectsLoading] = useState(false);
  const [redirectsRefreshing, setRedirectsRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "pages" | "posts";
    from: string;
  } | null>(null);
  const productionReadOnly = isProductionSiteAdminConnection(connection.baseUrl);

  const anyDirty = useMemo(() => {
    const overrideDirty = overrides.some((row) => {
      const draft = overrideDrafts[row.pageId];
      return draft ? isOverrideDirty(row, draft) : false;
    });
    const protectedDirty = protectedRows.some((row) => {
      const draft = protectedDrafts[row.rowId];
      return draft ? isProtectedDirty(row, draft) : false;
    });
    return overrideDirty || protectedDirty;
  }, [overrides, overrideDrafts, protectedRows, protectedDrafts]);

  const applyConflict = useCallback(
    (msg: string) => {
      setConflict(true);
      setMessage("warn", `${msg} Reload latest and apply your edit again.`);
    },
    [setMessage],
  );

  const loadRoutes = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      const response = await request("/api/site-admin/routes", "GET");
      setLoading(false);
      if (!response.ok) {
        if (!options.silent) {
          setMessage("error", `Load routes failed: ${response.code}: ${response.error}`);
        }
        return false;
      }
      const payload = (response.data ?? {}) as Record<string, unknown>;
      const srcVersion = payload.sourceVersion as
        | {
            siteConfigSha?: string;
            protectedRoutesSha?: string;
            branchSha?: string;
          }
        | undefined;
      if (
        !srcVersion?.siteConfigSha ||
        !srcVersion.protectedRoutesSha ||
        !srcVersion.branchSha
      ) {
        if (!options.silent) {
          setMessage("error", "Load routes failed: missing sourceVersion");
        }
        return false;
      }
      const ov = Array.isArray(payload.overrides)
        ? payload.overrides.map(normalizeOverride)
        : [];
      const prot = Array.isArray(payload.protectedRoutes)
        ? payload.protectedRoutes.map(normalizeProtected)
        : [];
      setSourceVersion({
        siteConfigSha: srcVersion.siteConfigSha,
        protectedRoutesSha: srcVersion.protectedRoutesSha,
        branchSha: srcVersion.branchSha,
      });
      setOverrides(ov);
      setOverrideDrafts(Object.fromEntries(ov.map((row) => [row.pageId, clone(row)])));
      setOverrideSaving({});
      setProtectedRows(prot);
      setProtectedDrafts(Object.fromEntries(prot.map((row) => [row.rowId, clone(row)])));
      setProtectedSaving({});
      setConflict(false);
      if (!options.silent) setMessage("success", "Routes loaded.");
      return true;
    },
    [request, setMessage],
  );

  const saveOverride = useCallback(
    async (pageId: string) => {
      if (productionReadOnly) {
        setMessage(
          "warn",
          "Production profile is read-only. Switch to Staging to save route overrides, then promote to production.",
        );
        return;
      }
      if (conflict) {
        setMessage("warn", "Routes are in conflict state. Reload latest before saving.");
        return;
      }
      if (!sourceVersion?.siteConfigSha) {
        setMessage("error", "Routes sourceVersion missing. Reload routes first.");
        return;
      }
      const draft = overrideDrafts[pageId];
      const base = overrides.find((row) => row.pageId === pageId);
      if (!draft || !base) {
        setMessage("error", "Override row not found.");
        return;
      }
      if (!isOverrideDirty(base, draft)) {
        setMessage("warn", `No override changes for page ${pageId}.`);
        return;
      }
      setOverrideSaving((prev) => ({ ...prev, [pageId]: true }));
      const response = await request("/api/site-admin/routes", "POST", {
        kind: "override",
        pageId,
        routePath: normalizeString(draft.routePath),
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });
      setOverrideSaving((prev) => ({ ...prev, [pageId]: false }));
      if (!response.ok) {
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          applyConflict(`Save override for ${pageId} failed with SOURCE_CONFLICT.`);
          return;
        }
        setMessage("error", `Save override failed: ${response.code}: ${response.error}`);
        return;
      }
      setMessage("success", `Override saved for ${pageId}.`);
      await loadRoutes({ silent: true });
    },
    [
      conflict,
      productionReadOnly,
      sourceVersion,
      overrideDrafts,
      overrides,
      request,
      setMessage,
      applyConflict,
      loadRoutes,
    ],
  );

  const createOverride = useCallback(async () => {
    if (productionReadOnly) {
      setMessage(
        "warn",
        "Production profile is read-only. Switch to Staging to create route overrides, then promote to production.",
      );
      return;
    }
    if (conflict) {
      setMessage("warn", "Routes are in conflict state. Reload latest before creating overrides.");
      return;
    }
    if (!sourceVersion?.siteConfigSha) {
      setMessage("error", "Routes sourceVersion missing. Reload routes first.");
      return;
    }
    const pageId = normalizeString(newOverride.pageId);
    const routePath = normalizeString(newOverride.routePath);
    if (!pageId || !routePath) {
      setMessage("error", "Create override requires pageId and routePath.");
      return;
    }
    setCreatingOverride(true);
    const response = await request("/api/site-admin/routes", "POST", {
      kind: "override",
      pageId,
      routePath,
      expectedSiteConfigSha: sourceVersion.siteConfigSha,
    });
    setCreatingOverride(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        applyConflict(`Create override for ${pageId} failed with SOURCE_CONFLICT.`);
        return;
      }
      setMessage("error", `Create override failed: ${response.code}: ${response.error}`);
      return;
    }
    setNewOverride(BLANK_NEW_OVERRIDE);
    setMessage("success", `Override created for ${pageId}.`);
    await loadRoutes({ silent: true });
  }, [
    conflict,
    productionReadOnly,
    sourceVersion,
    newOverride,
    request,
    setMessage,
    applyConflict,
    loadRoutes,
  ]);

  const saveProtected = useCallback(
    async (rowId: string) => {
      if (productionReadOnly) {
        setMessage(
          "warn",
          "Production profile is read-only. Switch to Staging to save protected routes, then promote to production.",
        );
        return;
      }
      if (conflict) {
        setMessage("warn", "Routes are in conflict state. Reload latest before saving.");
        return;
      }
      if (!sourceVersion?.protectedRoutesSha) {
        setMessage("error", "Routes sourceVersion missing. Reload routes first.");
        return;
      }
      const draft = protectedDrafts[rowId];
      const base = protectedRows.find((row) => row.rowId === rowId);
      if (!draft || !base) {
        setMessage("error", "Protected route row not found.");
        return;
      }
      if (!isProtectedDirty(base, draft)) {
        setMessage("warn", `No protected-route changes for ${draft.pageId}.`);
        return;
      }
      const validationError = validateProtected(draft);
      if (validationError) {
        setMessage("error", validationError);
        return;
      }
      setProtectedSaving((prev) => ({ ...prev, [rowId]: true }));
      const response = await request("/api/site-admin/routes", "POST", {
        kind: "protected",
        pageId: draft.pageId,
        path: normalizeString(draft.path),
        auth: draft.auth,
        password: normalizeString(draft.password),
        expectedProtectedRoutesSha: sourceVersion.protectedRoutesSha,
      });
      setProtectedSaving((prev) => ({ ...prev, [rowId]: false }));
      if (!response.ok) {
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          applyConflict(`Save protected route for ${draft.pageId} failed with SOURCE_CONFLICT.`);
          return;
        }
        setMessage(
          "error",
          `Save protected route failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      setMessage("success", `Protected route saved for ${draft.pageId}.`);
      await loadRoutes({ silent: true });
    },
    [
      conflict,
      productionReadOnly,
      sourceVersion,
      protectedDrafts,
      protectedRows,
      request,
      setMessage,
      applyConflict,
      loadRoutes,
    ],
  );

  const createProtected = useCallback(async () => {
    if (productionReadOnly) {
      setMessage(
        "warn",
        "Production profile is read-only. Switch to Staging to create protected routes, then promote to production.",
      );
      return;
    }
    if (conflict) {
      setMessage(
        "warn",
        "Routes are in conflict state. Reload latest before creating protected routes.",
      );
      return;
    }
    if (!sourceVersion?.protectedRoutesSha) {
      setMessage("error", "Routes sourceVersion missing. Reload routes first.");
      return;
    }
    const validationError = validateProtected(newProtected);
    if (validationError) {
      setMessage("error", validationError);
      return;
    }
    setCreatingProtected(true);
    const response = await request("/api/site-admin/routes", "POST", {
      kind: "protected",
      pageId: normalizeString(newProtected.pageId),
      path: normalizeString(newProtected.path),
      auth: newProtected.auth,
      password: normalizeString(newProtected.password),
      expectedProtectedRoutesSha: sourceVersion.protectedRoutesSha,
    });
    setCreatingProtected(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        applyConflict(
          `Create protected route for ${newProtected.pageId} failed with SOURCE_CONFLICT.`,
        );
        return;
      }
      setMessage(
        "error",
        `Create protected route failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    setNewProtected(BLANK_NEW_PROTECTED);
    setMessage("success", `Protected route created for ${newProtected.pageId}.`);
    await loadRoutes({ silent: true });
  }, [
    conflict,
    productionReadOnly,
    sourceVersion,
    newProtected,
    request,
    setMessage,
    applyConflict,
    loadRoutes,
  ]);

  const loadRedirects = useCallback(
    async (options: { silent?: boolean; refresh?: boolean } = {}) => {
      if (options.refresh) {
        setRedirectsRefreshing(true);
      } else {
        setRedirectsLoading(true);
      }
      const response = await request("/api/site-admin/redirects", "GET");
      if (options.refresh) {
        setRedirectsRefreshing(false);
      } else {
        setRedirectsLoading(false);
      }
      if (!response.ok) {
        if (!options.silent) {
          setMessage(
            "error",
            `Load redirects failed: ${response.code}: ${response.error}`,
          );
        }
        return;
      }
      const payload = (response.data ?? {}) as Record<string, unknown>;
      const pages =
        payload.pages && typeof payload.pages === "object"
          ? (payload.pages as Record<string, string>)
          : {};
      const posts =
        payload.posts && typeof payload.posts === "object"
          ? (payload.posts as Record<string, string>)
          : {};
      setRedirects({ pages, posts });
    },
    [request, setMessage],
  );

  const deleteRedirectEntry = useCallback(
    async (kind: "pages" | "posts", fromSlug: string) => {
      if (productionReadOnly) {
        setMessage(
          "warn",
          "Production profile is read-only. Switch to Staging to delete redirects, then promote to production.",
        );
        return;
      }
      setPendingDelete({ kind, from: fromSlug });
      const response = await request("/api/site-admin/redirects", "DELETE", {
        kind,
        fromSlug,
      });
      setPendingDelete(null);
      if (!response.ok) {
        setMessage(
          "error",
          `Delete redirect failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      setMessage("success", `Redirect deleted: /${kind === "posts" ? "blog" : "pages"}/${fromSlug}.`);
      await loadRedirects({ silent: true, refresh: true });
    },
    [productionReadOnly, request, setMessage, loadRedirects],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Redirects are loaded from the admin API on mount; the loader owns loading state. */
  useEffect(() => {
    void loadRedirects({ silent: true });
  }, [loadRedirects]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateOverrideDraft = useCallback(
    (pageId: string, value: string) => {
      setOverrideDrafts((prev) => {
        const existing = prev[pageId];
        if (!existing) return prev;
        return { ...prev, [pageId]: { ...existing, routePath: value } };
      });
    },
    [],
  );

  const updateProtectedDraft = useCallback(
    <K extends keyof ProtectedRow>(rowId: string, key: K, value: ProtectedRow[K]) => {
      setProtectedDrafts((prev) => {
        const existing = prev[rowId];
        if (!existing) return prev;
        const next = { ...existing, [key]: value };
        // Clearing password when switching off `password` auth mirrors the
        // vanilla form's behavior so we don't leak credentials in the
        // client-side buffer across auth-mode switches.
        if (key === "auth" && value !== "password") {
          next.password = "";
        }
        return { ...prev, [rowId]: next };
      });
    },
    [],
  );

  const stateNote = loading
    ? "Loading routes…"
    : conflict
      ? "Conflict detected (SOURCE_CONFLICT). Reload latest before saving again."
      : sourceVersion
        ? `Dirty state: ${anyDirty ? "yes" : "no"}`
        : "Routes not loaded.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Routes
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Path overrides and per-page protection rules.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadRoutes()}
            disabled={loading}
          >
            Reload Latest
          </button>
        </div>
      </header>
      <p className="m-0 text-[12px] text-text-muted">
        {sourceVersion
          ? `siteConfigSha=${sourceVersion.siteConfigSha} | protectedRoutesSha=${sourceVersion.protectedRoutesSha} | branchSha=${sourceVersion.branchSha}`
          : "sourceVersion: -"}
      </p>
      {productionReadOnly ? (
        <div className="workspace-status-banner workspace-status-banner--warn">
          Production is read-only in the desktop editor. Edit routes in
          Staging, then promote the validated staging version to production.
        </div>
      ) : null}
      <p className="m-0 text-[12px] text-text-muted">{stateNote}</p>

      <OverridesSection
        overrides={overrides}
        overrideDrafts={overrideDrafts}
        overrideSaving={overrideSaving}
        conflict={conflict}
        loading={loading}
        sourceVersion={sourceVersion}
        creatingOverride={creatingOverride}
        newOverride={newOverride}
        setNewOverride={setNewOverride}
        updateOverrideDraft={updateOverrideDraft}
        saveOverride={(pageId) => void saveOverride(pageId)}
        createOverride={() => void createOverride()}
        readOnly={productionReadOnly}
      />

      <ProtectedSection
        protectedRows={protectedRows}
        protectedDrafts={protectedDrafts}
        protectedSaving={protectedSaving}
        conflict={conflict}
        loading={loading}
        sourceVersion={sourceVersion}
        creatingProtected={creatingProtected}
        newProtected={newProtected}
        setNewProtected={setNewProtected}
        updateProtectedDraft={updateProtectedDraft}
        saveProtected={(rowId) => void saveProtected(rowId)}
        createProtected={() => void createProtected()}
        readOnly={productionReadOnly}
      />

      <RedirectsSection
        pages={redirects.pages}
        posts={redirects.posts}
        loading={redirectsLoading}
        refreshing={redirectsRefreshing}
        pendingDelete={pendingDelete}
        onRefresh={() => void loadRedirects({ refresh: true })}
        onDelete={(kind, from) => void deleteRedirectEntry(kind, from)}
        readOnly={productionReadOnly}
      />
    </section>
  );
}
