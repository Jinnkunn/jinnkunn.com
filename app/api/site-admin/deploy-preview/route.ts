import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { getSiteAdminDeployPreviewBackend } from "@/lib/server/site-admin-backend-service";
import type { SiteAdminDeployPreviewPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const out = await getSiteAdminDeployPreviewBackend();
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      const payload = out.data;
      return apiPayloadOk<Omit<SiteAdminDeployPreviewPayload, "ok">>(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      rateLimit: { namespace: "site-admin-deploy-preview" },
    },
  );
}
