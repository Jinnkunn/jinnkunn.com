import type { SiteAdminDeployPayload, SiteAdminDeployResult } from "./api-types";

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

export function isSiteAdminDeployOk(v: SiteAdminDeployResult): v is SiteAdminDeployPayload {
  return v.ok;
}

export function parseSiteAdminDeployResult(x: unknown): SiteAdminDeployResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: ack.error || "Request failed" };
  if (!isRecord(x)) return null;
  if (typeof x.triggeredAt !== "string" || typeof x.status !== "number") return null;
  return { ok: true, triggeredAt: x.triggeredAt, status: x.status };
}
