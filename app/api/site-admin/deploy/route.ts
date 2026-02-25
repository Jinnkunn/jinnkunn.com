import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { triggerDeployHook } from "@/lib/server/deploy-hook";
import { formatDeployTriggerError, trimErrorDetail } from "@/lib/server/api-response";
import type { SiteAdminDeployPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withSiteAdmin(
    req,
    async () => {
      const triggeredAtIso = new Date().toISOString();
      const out = await triggerDeployHook();

      if (!out.ok) {
        return apiError(
          formatDeployTriggerError(out.status, out.attempts, trimErrorDetail(out.text)),
          { status: 502, code: "DEPLOY_TRIGGER_FAILED" },
        );
      }

      const payload: Omit<SiteAdminDeployPayload, "ok"> = {
        triggeredAt: triggeredAtIso,
        status: out.status,
      };
      return apiPayloadOk<Omit<SiteAdminDeployPayload, "ok">>(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
    },
  );
}
