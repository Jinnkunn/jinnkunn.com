import type { NextRequest } from "next/server";

import { apiPayloadOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { buildSiteAdminDeployPreviewPayload } from "@/lib/server/site-admin-deploy-preview-service";
import type { SiteAdminDeployPreviewPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdmin(
    req,
    async () => {
      const payload = await buildSiteAdminDeployPreviewPayload();
      return apiPayloadOk<SiteAdminDeployPreviewPayload>(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
    },
  );
}
