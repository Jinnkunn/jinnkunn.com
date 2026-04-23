import type { NextRequest } from "next/server";

import { apiError, apiOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { getSiteAdminStatusBackend } from "@/lib/server/site-admin-backend-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const out = await getSiteAdminStatusBackend();
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      const payload = out.data;
      return apiOk(payload);
    },
    { rateLimit: { namespace: "site-admin-status" } },
  );
}
