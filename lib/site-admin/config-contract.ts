import {
  asApiAck,
  isRecord,
  readApiErrorCode,
  readApiErrorMessage,
  unwrapApiData,
} from "../client/api-guards.ts";
import { toNumberOrZero, toStringValue } from "./contract-helpers.ts";
import type {
  SiteAdminConfigGetPayload,
  SiteAdminConfigGetResult,
  SiteAdminConfigPostPayload,
  SiteAdminConfigPostResult,
} from "./api-types.ts";
import type { NavItemRow, SiteSettings } from "./types.ts";

function isSiteAdminConfigGetSuccess(
  x: unknown,
): x is { settings: SiteSettings | null; nav: NavItemRow[] } {
  return isRecord(x) && "settings" in x && Array.isArray(x.nav);
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

export function parseSiteAdminConfigGet(v: unknown): SiteAdminConfigGetResult | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(v) || ack.error,
      code: readApiErrorCode(v) || ack.code || "REQUEST_FAILED",
    };
  }
  const payload = unwrapApiData(v);
  if (!isSiteAdminConfigGetSuccess(payload)) return null;
  return {
    ok: true,
    settings: payload.settings,
    nav: payload.nav,
  };
}

export function parseSiteAdminConfigPost(v: unknown): SiteAdminConfigPostResult | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(v) || ack.error,
      code: readApiErrorCode(v) || ack.code || "REQUEST_FAILED",
    };
  }
  const payload = unwrapApiData(v);
  if (!isRecord(payload)) return { ok: true };
  const created = parseCreatedNavRow(payload.created);
  return created ? { ok: true, created } : { ok: true };
}
