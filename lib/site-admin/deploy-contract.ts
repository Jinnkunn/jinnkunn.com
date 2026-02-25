import type { SiteAdminDeployPayload, SiteAdminDeployResult } from "./api-types";

import {
  asApiAck,
  isRecord,
  readApiErrorCode,
  readApiErrorMessage,
  unwrapApiData,
} from "../client/api-guards.ts";

export function isSiteAdminDeployOk(v: SiteAdminDeployResult): v is SiteAdminDeployPayload {
  return v.ok;
}

export function parseSiteAdminDeployResult(x: unknown): SiteAdminDeployResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(x) || ack.error || "Request failed",
      code: readApiErrorCode(x) || ack.code || "REQUEST_FAILED",
    };
  }
  const payload = unwrapApiData(x);
  if (!isRecord(payload)) return null;
  if (typeof payload.triggeredAt !== "string" || typeof payload.status !== "number") return null;
  return { ok: true, triggeredAt: payload.triggeredAt, status: payload.status };
}
