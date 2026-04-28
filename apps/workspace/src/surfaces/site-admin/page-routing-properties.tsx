import { useCallback, useEffect, useMemo, useState } from "react";

import { useSiteAdmin } from "./state";
import type {
  OverrideRow,
  ProtectedRow,
  RoutesSourceVersion,
} from "./types";
import { normalizeOverride, normalizeProtected, normalizeString } from "./utils";
import {
  WorkspaceInspectorSection,
  WorkspaceSelectField,
  WorkspaceTextField,
} from "../../ui/primitives";

interface PageRoutingPropertiesProps {
  /** The page's slug (used as the pageId key against /api/site-admin/routes). */
  slug: string;
  /** Public path rendered by the website, for example /about or /blog/post-slug. */
  publicPath?: string;
}

interface OverrideDraft {
  routePath: string;
  enabled: boolean;
}

interface ProtectedDraft {
  path: string;
  auth: "public" | "password" | "github";
  password: string;
  enabled: boolean;
}

const BLANK_OVERRIDE: OverrideDraft = { routePath: "", enabled: true };
const BLANK_PROTECTED: ProtectedDraft = {
  path: "",
  auth: "public",
  password: "",
  enabled: true,
};

function normalizeRoutePathInput(path: string): string {
  const raw = path.trim();
  if (!raw) return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function publicPathForSlug(slug: string): string {
  return normalizeRoutePathInput(slug);
}

/** Compact "URL & Protection" panel rendered next to the page's
 * frontmatter inside the page editor. Talks to the same
 * `/api/site-admin/routes` endpoint as RoutesPanel — just scoped to one
 * page so the user doesn't have to leave the editor to give the page a
 * custom URL or password-protect it. Independent save per section to
 * keep the UX simple (no shared draft / dirty bookkeeping with the page
 * MDX save). */
export function PageRoutingProperties({ slug, publicPath }: PageRoutingPropertiesProps) {
  const { request, setMessage } = useSiteAdmin();
  const [loading, setLoading] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [savingProtected, setSavingProtected] = useState(false);
  const [sourceVersion, setSourceVersion] = useState<RoutesSourceVersion | null>(null);
  const [override, setOverride] = useState<OverrideDraft>(BLANK_OVERRIDE);
  const [protectedRow, setProtectedRow] = useState<ProtectedDraft>(BLANK_PROTECTED);
  const [protectedBasePath, setProtectedBasePath] = useState("");
  const [hasOverride, setHasOverride] = useState(false);
  const [hasProtected, setHasProtected] = useState(false);

  const pageId = useMemo(() => slug.trim(), [slug]);
  const defaultProtectedPath = useMemo(
    () => normalizeRoutePathInput(publicPath || publicPathForSlug(slug)),
    [publicPath, slug],
  );

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    const response = await request("/api/site-admin/routes", "GET");
    setLoading(false);
    if (!response.ok) {
      setMessage(
        "error",
        `Load page routing failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    const payload = (response.data ?? {}) as Record<string, unknown>;
    const srcVersion = payload.sourceVersion as
      | { siteConfigSha?: string; protectedRoutesSha?: string; branchSha?: string }
      | undefined;
    if (srcVersion?.siteConfigSha && srcVersion.protectedRoutesSha && srcVersion.branchSha) {
      setSourceVersion({
        siteConfigSha: srcVersion.siteConfigSha,
        protectedRoutesSha: srcVersion.protectedRoutesSha,
        branchSha: srcVersion.branchSha,
      });
    }

    const overrides: OverrideRow[] = Array.isArray(payload.overrides)
      ? (payload.overrides as unknown[]).map(normalizeOverride)
      : [];
    const protectedRows: ProtectedRow[] = Array.isArray(payload.protectedRoutes)
      ? (payload.protectedRoutes as unknown[]).map(normalizeProtected)
      : [];

    const matchingOverride = overrides.find((row) => row.pageId === pageId);
    if (matchingOverride) {
      setOverride({
        routePath: matchingOverride.routePath,
        enabled: matchingOverride.enabled,
      });
      setHasOverride(true);
    } else {
      setOverride(BLANK_OVERRIDE);
      setHasOverride(false);
    }

    const matchingProtected = protectedRows.find((row) =>
      row.pageId === pageId ||
      normalizeRoutePathInput(row.path) === defaultProtectedPath,
    );
    if (matchingProtected) {
      setProtectedRow({
        path: matchingProtected.path,
        auth: matchingProtected.auth,
        // Server never returns the password (write-only); leave empty so
        // the user can re-enter to change, but blank means "keep existing".
        password: "",
        enabled: matchingProtected.enabled,
      });
      setProtectedBasePath(matchingProtected.path);
      setHasProtected(true);
    } else {
      setProtectedRow({ ...BLANK_PROTECTED, path: defaultProtectedPath });
      setProtectedBasePath("");
      setHasProtected(false);
    }
  }, [defaultProtectedPath, pageId, request, setMessage]);

  /* eslint-disable react-hooks/set-state-in-effect -- Route properties are fetched from the admin API whenever the edited page changes. */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveOverride = useCallback(async () => {
    if (!pageId || !sourceVersion) return;
    setSavingOverride(true);
    const response = await request("/api/site-admin/routes", "POST", {
      kind: "override",
      pageId,
      routePath: normalizeString(override.routePath),
      expectedSiteConfigSha: sourceVersion.siteConfigSha,
    });
    setSavingOverride(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setMessage(
          "warn",
          "Routes changed on the server. Reload the page editor to pick up the latest.",
        );
        return;
      }
      setMessage(
        "error",
        `Save URL override failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    setMessage("success", `URL override saved for ${pageId}.`);
    await load();
  }, [pageId, sourceVersion, override, request, setMessage, load]);

  const saveProtected = useCallback(async () => {
    if (!pageId || !sourceVersion) return;
    const nextPath = normalizeRoutePathInput(protectedRow.path) || defaultProtectedPath;
    const basePath = normalizeRoutePathInput(protectedBasePath);
    const passwordRequired =
      protectedRow.auth === "password" &&
      !protectedRow.password.trim() &&
      (!hasProtected || (basePath && nextPath !== basePath));
    if (passwordRequired) {
      setMessage("error", "Password required when auth mode is 'password'.");
      return;
    }
    setSavingProtected(true);
    const response = await request("/api/site-admin/routes", "POST", {
      kind: "protected",
      // MDX pages are slug/path based, not Notion page-id based. Sending
      // an empty pageId makes the backend write a path-key rule, which
      // is stable for ordinary content/pages/*.mdx pages.
      pageId: "",
      path: nextPath,
      auth: protectedRow.auth,
      password: normalizeString(protectedRow.password),
      expectedProtectedRoutesSha: sourceVersion.protectedRoutesSha,
    });
    setSavingProtected(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setMessage(
          "warn",
          "Protected routes changed on the server. Reload the page editor to pick up the latest.",
        );
        return;
      }
      setMessage(
        "error",
        `Save protection failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    setMessage("success", `Protection saved for ${pageId}.`);
    await load();
  }, [
    defaultProtectedPath,
    pageId,
    sourceVersion,
    protectedRow,
    protectedBasePath,
    hasProtected,
    request,
    setMessage,
    load,
  ]);

  if (!pageId) return null;

  return (
    <>
      <WorkspaceInspectorSection heading="URL override">
        <p className="page-routing-properties__hint">
          By default the page renders at <code>{defaultProtectedPath}</code>.
          Provide a custom path here to route requests for that path to
          this page (e.g. <code>/about</code>). Leave empty to disable.
        </p>
        <WorkspaceTextField
          label="Custom URL"
          value={override.routePath}
          placeholder="/about"
          disabled={loading || !sourceVersion}
          onChange={(event) =>
            setOverride((prev) => ({ ...prev, routePath: event.target.value }))
          }
        />
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void saveOverride()}
            disabled={loading || savingOverride || !sourceVersion}
          >
            {savingOverride ? "Saving…" : hasOverride ? "Update override" : "Add override"}
          </button>
        </div>
      </WorkspaceInspectorSection>

      <WorkspaceInspectorSection heading="Access">
        <p className="page-routing-properties__hint">
          Restricts access to the page. <code>password</code> requires
          one shared password; <code>github</code> requires NextAuth
          login with an allowed GitHub user; <code>public</code> removes
          all restrictions.
        </p>
        <WorkspaceTextField
          label="Path to protect"
          value={protectedRow.path}
          placeholder="/about"
          disabled={loading || !sourceVersion}
          onChange={(event) =>
            setProtectedRow((prev) => ({ ...prev, path: event.target.value }))
          }
        />
        <WorkspaceSelectField
          label="Auth mode"
          value={protectedRow.auth}
          disabled={loading || !sourceVersion}
          onChange={(event) =>
            setProtectedRow((prev) => ({
              ...prev,
              auth: event.target.value as ProtectedDraft["auth"],
              password: event.target.value === "password" ? prev.password : "",
            }))
          }
        >
          <option value="public">public</option>
          <option value="password">password</option>
          <option value="github">github</option>
        </WorkspaceSelectField>
        {protectedRow.auth === "password" ? (
          <WorkspaceTextField
            label="Password"
            type="password"
            value={protectedRow.password}
            placeholder={hasProtected ? "(leave blank to keep current)" : "Set a password"}
            disabled={loading || !sourceVersion}
            autoComplete="new-password"
            onChange={(event) =>
              setProtectedRow((prev) => ({ ...prev, password: event.target.value }))
            }
          />
        ) : null}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void saveProtected()}
            disabled={loading || savingProtected || !sourceVersion}
          >
            {savingProtected ? "Saving…" : hasProtected ? "Update protection" : "Add protection"}
          </button>
        </div>
      </WorkspaceInspectorSection>
    </>
  );
}
