import { isRecord } from "../client/api-guards.ts";
import { parseApiContract, toNumberOrZero, toStringValue } from "./contract-helpers.ts";
import type {
  SiteAdminConfigSourceVersion,
  SiteAdminConfigGetPayload,
  SiteAdminConfigGetResult,
  SiteAdminConfigPostPayload,
  SiteAdminConfigPostResult,
} from "./api-types.ts";
import type { NavItemRow, SiteSettings } from "./types.ts";

function isSiteAdminConfigGetSuccess(
  x: unknown,
): x is { settings: SiteSettings | null; nav: NavItemRow[]; sourceVersion: SiteAdminConfigSourceVersion } {
  return (
    isRecord(x) &&
    "settings" in x &&
    Array.isArray(x.nav) &&
    Boolean(parseSourceVersion(x.sourceVersion))
  );
}

export function isSiteAdminConfigGetOk(v: SiteAdminConfigGetResult): v is SiteAdminConfigGetPayload {
  return v.ok;
}

export function isSiteAdminConfigPostOk(v: SiteAdminConfigPostResult): v is SiteAdminConfigPostPayload {
  return v.ok;
}

export function parseCreatedNavRow(v: unknown): NavItemRow | null {
  if (!isRecord(v)) return null;
  const rowId = toStringValue(v.rowId).trim();
  if (!rowId) return null;
  return {
    rowId,
    label: toStringValue(v.label),
    href: toStringValue(v.href),
    group: toStringValue(v.group) === "top" ? "top" : "more",
    order: toNumberOrZero(v.order),
    enabled: Boolean(v.enabled),
  };
}

function parseSourceVersion(v: unknown): SiteAdminConfigSourceVersion | null {
  if (!isRecord(v)) return null;
  const siteConfigSha = toStringValue(v.siteConfigSha).trim();
  const branchSha = toStringValue(v.branchSha).trim();
  if (!siteConfigSha || !branchSha) return null;
  return {
    siteConfigSha,
    branchSha,
  };
}

export function parseSiteAdminConfigGet(v: unknown): SiteAdminConfigGetResult | null {
  return parseApiContract<SiteAdminConfigGetResult>(v, (payload) => {
    if (!isSiteAdminConfigGetSuccess(payload)) return null;
    return {
      ok: true,
      settings: payload.settings,
      nav: payload.nav,
      sourceVersion: parseSourceVersion(payload.sourceVersion)!,
    };
  });
}

export function parseSiteAdminConfigPost(v: unknown): SiteAdminConfigPostResult | null {
  return parseApiContract<SiteAdminConfigPostResult>(v, (payload) => {
    if (!isRecord(payload)) return null;
    const sourceVersion = parseSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    const created = parseCreatedNavRow(payload.created);
    return created ? { ok: true, created, sourceVersion } : { ok: true, sourceVersion };
  });
}
