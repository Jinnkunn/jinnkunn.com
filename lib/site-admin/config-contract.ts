import { asApiAck, isRecord } from "@/lib/client/api-guards";
import type {
  SiteAdminConfigGetPayload,
  SiteAdminConfigGetResult,
  SiteAdminConfigPostPayload,
  SiteAdminConfigPostResult,
} from "@/lib/site-admin/api-types";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

function toStringValue(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function toNumberValue(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isSiteAdminConfigGetSuccess(
  x: unknown,
): x is { ok: true; settings: SiteSettings | null; nav: NavItemRow[] } {
  return isRecord(x) && x.ok === true && "settings" in x && Array.isArray(x.nav);
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
    order: toNumberValue(v.order),
    enabled: Boolean(v.enabled),
  };
}

export function parseSiteAdminConfigGet(v: unknown): SiteAdminConfigGetResult | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) return ack;
  if (!isSiteAdminConfigGetSuccess(v)) return null;
  return v;
}

export function parseSiteAdminConfigPost(v: unknown): SiteAdminConfigPostResult | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) return ack;
  if (!isRecord(v)) return null;
  const created = parseCreatedNavRow(v.created);
  return created ? { ok: true, created } : { ok: true };
}

