import type {
  SiteAdminProtectedRoute,
  SiteAdminRoutesPostPayload,
  SiteAdminRoutesPostResult,
  SiteAdminRoutesSourceVersion,
  SiteAdminRouteOverride,
  SiteAdminRoutesGetPayload,
  SiteAdminRoutesResult,
} from "./api-types";
import { parseProtectedAccessMode } from "../shared/access.ts";
import { parseApiContract, toStringValue } from "./contract-helpers.ts";

import { isRecord } from "../client/api-guards.ts";

function parseRouteOverride(v: unknown): SiteAdminRouteOverride | null {
  if (!isRecord(v)) return null;
  const rowId = toStringValue(v.rowId).trim();
  const pageId = toStringValue(v.pageId).trim();
  const routePath = toStringValue(v.routePath).trim();
  if (!rowId || !pageId || !routePath) return null;
  return {
    rowId,
    pageId,
    routePath,
    enabled: true,
  };
}

function parseProtectedRoute(v: unknown): SiteAdminProtectedRoute | null {
  if (!isRecord(v)) return null;
  const rowId = toStringValue(v.rowId).trim();
  const pageId = toStringValue(v.pageId).trim();
  const path = toStringValue(v.path).trim();
  const mode = toStringValue(v.mode) === "prefix" ? "prefix" : toStringValue(v.mode) === "exact" ? "exact" : "";
  const auth = parseProtectedAccessMode(v.auth);
  if (!rowId || !path || !mode || !auth) return null;
  return {
    rowId,
    pageId,
    path,
    mode,
    auth,
    enabled: true,
  };
}

function parseSourceVersion(v: unknown): SiteAdminRoutesSourceVersion | null {
  if (!isRecord(v)) return null;
  const siteConfigSha = toStringValue(v.siteConfigSha).trim();
  const protectedRoutesSha = toStringValue(v.protectedRoutesSha).trim();
  const branchSha = toStringValue(v.branchSha).trim();
  if (!siteConfigSha || !protectedRoutesSha || !branchSha) return null;
  return {
    siteConfigSha,
    protectedRoutesSha,
    branchSha,
  };
}

export function isSiteAdminRoutesOk(v: SiteAdminRoutesResult): v is SiteAdminRoutesGetPayload {
  return v.ok;
}

export function isSiteAdminRoutesPostOk(v: SiteAdminRoutesPostResult): v is SiteAdminRoutesPostPayload {
  return v.ok;
}

export function parseSiteAdminRoutesResult(x: unknown): SiteAdminRoutesResult | null {
  return parseApiContract<SiteAdminRoutesResult>(x, (payload) => {
    if (!isRecord(payload)) return null;

    const adminPageId = toStringValue(payload.adminPageId).trim();
    if (!adminPageId || !isRecord(payload.databases)) return null;

    const overridesDbId = toStringValue(payload.databases.overridesDbId).trim();
    const protectedDbId = toStringValue(payload.databases.protectedDbId).trim();
    if (!overridesDbId || !protectedDbId) return null;
    const sourceVersion = parseSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;

    const overrides = Array.isArray(payload.overrides)
      ? payload.overrides.map(parseRouteOverride).filter((it): it is SiteAdminRouteOverride => Boolean(it))
      : null;
    const protectedRoutes = Array.isArray(payload.protectedRoutes)
      ? payload.protectedRoutes
          .map(parseProtectedRoute)
          .filter((it): it is SiteAdminProtectedRoute => Boolean(it))
      : null;
    if (!overrides || !protectedRoutes) return null;

    return {
      ok: true,
      adminPageId,
      databases: {
        overridesDbId,
        protectedDbId,
      },
      overrides,
      protectedRoutes,
      sourceVersion,
    };
  });
}

export function parseSiteAdminRoutesPost(x: unknown): SiteAdminRoutesPostResult | null {
  return parseApiContract<SiteAdminRoutesPostResult>(x, (payload) => {
    if (!isRecord(payload)) return null;
    const sourceVersion = parseSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;

    const override = parseRouteOverride(payload.override);
    const protectedRoute = parseProtectedRoute(payload.protected);
    return {
      ok: true,
      sourceVersion,
      ...(override ? { override } : {}),
      ...(protectedRoute ? { protected: protectedRoute } : {}),
    };
  });
}
