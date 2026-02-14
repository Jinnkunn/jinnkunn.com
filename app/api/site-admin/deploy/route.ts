import type { NextRequest } from "next/server";

import { apiError, apiOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { triggerDeployHook } from "@/lib/server/deploy-hook";
import type { SiteAdminDeployPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withSiteAdmin(
    req,
    async () => {
      const triggeredAtIso = new Date().toISOString();
      const out = await triggerDeployHook();

      if (!out.ok) {
        return apiError(`Failed to trigger deploy (status ${out.status})`, { status: 502 });
      }

      const payload: Omit<SiteAdminDeployPayload, "ok"> = {
        triggeredAt: triggeredAtIso,
        status: out.status,
      };
      return apiOk(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
    },
  );
}
