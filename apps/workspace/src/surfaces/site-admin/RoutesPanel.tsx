import { useCallback, useMemo, useState } from "react";
import { useSiteAdmin } from "./state";
import type {
  OverrideRow,
  ProtectedRow,
  RoutesSourceVersion,
} from "./types";
import {
  clone,
  isOverrideDirty,
  isProtectedDirty,
  normalizeOverride,
  normalizeProtected,
  normalizeString,
} from "./utils";

interface NewOverrideInput {
  pageId: string;
  routePath: string;
}

interface NewProtectedInput {
  pageId: string;
  path: string;
  auth: "password" | "github" | "public";
  password: string;
}

const BLANK_NEW_OVERRIDE: NewOverrideInput = { pageId: "", routePath: "" };
const BLANK_NEW_PROTECTED: NewProtectedInput = {
  pageId: "",
  path: "",
  auth: "password",
  password: "",
};

function validateProtected(draft: {
  pageId: string;
  path: string;
  auth: string;
  password: string;
}): string {
  if (!normalizeString(draft.pageId)) return "Protected route requires pageId.";
  if (!normalizeString(draft.path)) return "Protected route requires path.";
  const auth = normalizeString(draft.auth);
  if (!["password", "github", "public"].includes(auth)) {
    return "Protected route auth is invalid.";
  }
  if (auth === "password" && !normalizeString(draft.password)) {
    return "Password auth requires a password. Empty password disables protection.";
  }
  return "";
}

export function RoutesPanel() {
  const { request, setMessage } = useSiteAdmin();

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
  }, [conflict, sourceVersion, newOverride, request, setMessage, applyConflict, loadRoutes]);

  const saveProtected = useCallback(
    async (rowId: string) => {
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
  }, [conflict, sourceVersion, newProtected, request, setMessage, applyConflict, loadRoutes]);

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
      <p className="m-0 text-[12px] text-text-muted">{stateNote}</p>

      <details className="surface-details" open>
        <summary>Route Overrides</summary>
        <div className="flex flex-col gap-2 mt-1">
          {overrides.length === 0 ? (
            <p className="empty-note">No route overrides.</p>
          ) : (
            <>
              <div className="grid-row grid-header routes-override">
                <span>Page ID</span>
                <span>Route Path</span>
                <span>Action</span>
              </div>
              {overrides.map((row) => {
                const draft = overrideDrafts[row.pageId] ?? row;
                const dirty = isOverrideDirty(row, draft);
                const saving = Boolean(overrideSaving[row.pageId]);
                return (
                  <div className="grid-row routes-override" key={row.pageId}>
                    <span>{row.pageId}</span>
                    <input
                      value={draft.routePath}
                      placeholder="/custom-path (empty disables)"
                      onChange={(e) => updateOverrideDraft(row.pageId, e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn--secondary"
                        type="button"
                        disabled={conflict || saving}
                        onClick={() => void saveOverride(row.pageId)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                        {dirty ? "unsaved" : "saved"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <h3 className="mt-4 mb-2 text-[13px] font-semibold text-text-primary">
          Create Override
        </h3>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Page ID
            <input
              value={newOverride.pageId}
              onChange={(e) =>
                setNewOverride({ ...newOverride, pageId: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Route Path
            <input
              value={newOverride.routePath}
              placeholder="/new-path"
              onChange={(e) =>
                setNewOverride({ ...newOverride, routePath: e.target.value })
              }
            />
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn"
            type="button"
            disabled={loading || creatingOverride || conflict || !sourceVersion}
            onClick={() => void createOverride()}
          >
            Create Override
          </button>
        </div>
      </details>

      <details className="surface-details" open>
        <summary>Protected Routes</summary>
        <div className="flex flex-col gap-2 mt-1">
          {protectedRows.length === 0 ? (
            <p className="empty-note">No protected routes.</p>
          ) : (
            <>
              <div className="grid-row grid-header routes-protected">
                <span>Page ID</span>
                <span>Path</span>
                <span>Auth</span>
                <span>Password</span>
                <span>Action</span>
              </div>
              {protectedRows.map((row) => {
                const draft = protectedDrafts[row.rowId] ?? row;
                const dirty = isProtectedDirty(row, draft);
                const saving = Boolean(protectedSaving[row.rowId]);
                const passwordDisabled = draft.auth !== "password";
                return (
                  <div className="grid-row routes-protected" key={row.rowId}>
                    <span>{row.pageId}</span>
                    <input
                      value={draft.path}
                      placeholder="/path"
                      onChange={(e) =>
                        updateProtectedDraft(row.rowId, "path", e.target.value)
                      }
                    />
                    <select
                      value={draft.auth}
                      onChange={(e) =>
                        updateProtectedDraft(
                          row.rowId,
                          "auth",
                          (e.target.value as ProtectedRow["auth"]) ?? "password",
                        )
                      }
                    >
                      <option value="password">password</option>
                      <option value="github">github</option>
                      <option value="public">public (disable protection)</option>
                    </select>
                    <input
                      type="password"
                      value={draft.password}
                      placeholder={
                        passwordDisabled ? "unused" : "required for password auth"
                      }
                      disabled={passwordDisabled}
                      onChange={(e) =>
                        updateProtectedDraft(row.rowId, "password", e.target.value)
                      }
                    />
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn--secondary"
                        type="button"
                        disabled={conflict || saving}
                        onClick={() => void saveProtected(row.rowId)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                        {dirty ? "unsaved" : "saved"} | mode={row.mode}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <h3 className="mt-4 mb-2 text-[13px] font-semibold text-text-primary">
          Create Protected Route
        </h3>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Page ID
            <input
              value={newProtected.pageId}
              onChange={(e) =>
                setNewProtected({ ...newProtected, pageId: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Path
            <input
              value={newProtected.path}
              placeholder="/private"
              onChange={(e) =>
                setNewProtected({ ...newProtected, path: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Auth
            <select
              value={newProtected.auth}
              onChange={(e) =>
                setNewProtected({
                  ...newProtected,
                  auth: (e.target.value as NewProtectedInput["auth"]) ?? "password",
                  password:
                    (e.target.value as string) === "password" ? newProtected.password : "",
                })
              }
            >
              <option value="password">password</option>
              <option value="github">github</option>
              <option value="public">public (disable protection)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Password (password auth only)
            <input
              type="password"
              value={newProtected.password}
              disabled={newProtected.auth !== "password"}
              onChange={(e) =>
                setNewProtected({ ...newProtected, password: e.target.value })
              }
            />
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn"
            type="button"
            disabled={loading || creatingProtected || conflict || !sourceVersion}
            onClick={() => void createProtected()}
          >
            Create Protected Route
          </button>
        </div>
      </details>
    </section>
  );
}
