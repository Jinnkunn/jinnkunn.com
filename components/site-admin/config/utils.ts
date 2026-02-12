import type { ApiGet, ApiPost, NavItemRow, SiteSettings } from "./types";
import { asApiAck, isRecord } from "@/lib/client/api-guards";
export { isApiOk, readApiErrorMessage } from "@/lib/client/api-guards";

export function errorFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isApiGetOk(v: ApiGet): v is Extract<ApiGet, { ok: true }> {
  return v.ok;
}

export function isApiPostOk(v: ApiPost): v is Extract<ApiPost, { ok: true }> {
  return v.ok;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export function asString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export function asNumber(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function isApiGetSuccess(
  x: unknown,
): x is { ok: true; settings: SiteSettings | null; nav: NavItemRow[] } {
  return isRecord(x) && x.ok === true && "settings" in x && Array.isArray(x.nav);
}

export function asApiPost(v: unknown): ApiPost | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) return ack;
  if (!isRecord(v)) return null;
  const created = asCreatedNavRow(v.created);
  return created ? { ok: true, created } : { ok: true };
}

export function asCreatedNavRow(v: unknown): NavItemRow | null {
  if (!isRecord(v)) return null;
  const rowId = asString(v.rowId).trim();
  if (!rowId) return null;
  return {
    rowId,
    label: asString(v.label),
    href: asString(v.href),
    group: asString(v.group) === "top" ? "top" : "more",
    order: asNumber(v.order),
    enabled: Boolean(v.enabled),
  };
}

export function asApiGet(v: unknown): ApiGet | null {
  const ack = asApiAck(v);
  if (!ack) return null;
  if (!ack.ok) return ack;
  if (!isApiGetSuccess(v)) return null;
  return v;
}
