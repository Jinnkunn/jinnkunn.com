import type { SiteAdminDeployPayload, SiteAdminDeployResult } from "./api-types";

import { isRecord } from "../client/api-guards.ts";
import { parseApiContract } from "./contract-helpers.ts";

export function isSiteAdminDeployOk(v: SiteAdminDeployResult): v is SiteAdminDeployPayload {
  return v.ok;
}

export function parseSiteAdminDeployResult(x: unknown): SiteAdminDeployResult | null {
  return parseApiContract<SiteAdminDeployResult>(x, (payload) => {
    if (!isRecord(payload)) return null;
    if (typeof payload.triggeredAt !== "string" || typeof payload.status !== "number") return null;
    const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
    const deploymentId =
      typeof payload.deploymentId === "string" ? payload.deploymentId.trim() : "";
    return {
      ok: true,
      triggeredAt: payload.triggeredAt,
      status: payload.status,
      ...(provider === "generic" || provider === "vercel" || provider === "cloudflare"
        ? { provider }
        : {}),
      ...(deploymentId ? { deploymentId } : {}),
    };
  });
}
