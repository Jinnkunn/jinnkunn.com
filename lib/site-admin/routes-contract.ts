import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
  SiteAdminRoutesGetPayload,
  SiteAdminRoutesResult,
} from "./api-types";
import { normalizeProtectedAccessMode } from "../shared/access.ts";
import { toStringValue } from "./contract-helpers.ts";

import {
  asApiAck,
  isRecord,
  readApiErrorCode,
  readApiErrorMessage,
  unwrapApiData,
} from "../client/api-guards.ts";

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
  const rawAuth = toStringValue(v.auth).trim().toLowerCase();
  const auth = rawAuth ? normalizeProtectedAccessMode(rawAuth, "password") : null;
  if (!rowId || !pageId || !path || !mode || !auth) return null;
  return {
    rowId,
    pageId,
    path,
    mode,
    auth,
    enabled: true,
  };
}

export function isSiteAdminRoutesOk(v: SiteAdminRoutesResult): v is SiteAdminRoutesGetPayload {
  return v.ok;
}

export function parseSiteAdminRoutesResult(x: unknown): SiteAdminRoutesResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(x) || ack.error,
      code: readApiErrorCode(x) || ack.code || "REQUEST_FAILED",
    };
  }

  const payload = unwrapApiData(x);
  if (!isRecord(payload)) return null;

  const adminPageId = toStringValue(payload.adminPageId).trim();
  if (!adminPageId || !isRecord(payload.databases)) return null;

  const overridesDbId = toStringValue(payload.databases.overridesDbId).trim();
  const protectedDbId = toStringValue(payload.databases.protectedDbId).trim();
  if (!overridesDbId || !protectedDbId) return null;

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
  };
}
