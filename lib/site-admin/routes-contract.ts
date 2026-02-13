import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
  SiteAdminRoutesGetPayload,
  SiteAdminRoutesResult,
} from "./api-types";

type ApiAck = { ok: true } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readApiErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  const error = value.error;
  return typeof error === "string" && error.trim() ? error : "";
}

function asApiAck(value: unknown, fallbackError = "Request failed"): ApiAck | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) return { ok: true };
  return { ok: false, error: readApiErrorMessage(value) || fallbackError };
}

function toStringValue(x: unknown): string {
  return typeof x === "string" ? x : "";
}

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
  const auth =
    toStringValue(v.auth) === "github" ? "github" : toStringValue(v.auth) === "password" ? "password" : "";
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
  if (!ack.ok) return { ok: false, error: readApiErrorMessage(ack) || "Request failed" };
  if (!isRecord(x)) return null;

  const adminPageId = toStringValue(x.adminPageId).trim();
  if (!adminPageId || !isRecord(x.databases)) return null;

  const overridesDbId = toStringValue(x.databases.overridesDbId).trim();
  const protectedDbId = toStringValue(x.databases.protectedDbId).trim();
  if (!overridesDbId || !protectedDbId) return null;

  const overrides = Array.isArray(x.overrides)
    ? x.overrides.map(parseRouteOverride).filter((it): it is SiteAdminRouteOverride => Boolean(it))
    : null;
  const protectedRoutes = Array.isArray(x.protectedRoutes)
    ? x.protectedRoutes
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
