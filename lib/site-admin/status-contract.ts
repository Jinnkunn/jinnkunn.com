import { asApiAck, readApiErrorMessage } from "@/lib/client/api-guards";
import type { SiteAdminStatusPayload, SiteAdminStatusResult } from "@/lib/site-admin/api-types";

export function isSiteAdminStatusOk(v: SiteAdminStatusResult): v is SiteAdminStatusPayload {
  return v.ok;
}

export function parseSiteAdminStatusResult(x: unknown): SiteAdminStatusResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: readApiErrorMessage(ack) || "Request failed" };
  return x as SiteAdminStatusPayload;
}

