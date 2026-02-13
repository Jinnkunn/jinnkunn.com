import { asApiAck, isRecord, readApiErrorMessage } from "@/lib/client/api-guards";
import type { SiteAdminStatusPayload, SiteAdminStatusResult } from "@/lib/site-admin/api-types";

export function isSiteAdminStatusOk(v: SiteAdminStatusResult): v is SiteAdminStatusPayload {
  return v.ok;
}

function isSiteAdminStatusPayload(x: unknown): x is SiteAdminStatusPayload {
  return (
    isRecord(x) &&
    x.ok === true &&
    isRecord(x.env) &&
    isRecord(x.build) &&
    isRecord(x.content) &&
    isRecord(x.files) &&
    isRecord(x.notion)
  );
}

export function parseSiteAdminStatusResult(x: unknown): SiteAdminStatusResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: readApiErrorMessage(ack) || "Request failed" };
  return isSiteAdminStatusPayload(x) ? x : null;
}
