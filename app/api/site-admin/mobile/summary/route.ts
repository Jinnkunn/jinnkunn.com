import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { getSiteAdminMobileSummary } from "@/lib/server/site-admin-mobile-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        const summary = await getSiteAdminMobileSummary();
        return apiPayloadOk({ summary });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return apiError(msg, { status: 500, code: "MOBILE_SUMMARY_FAILED" });
      }
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      rateLimit: { namespace: "site-admin-mobile-summary", maxRequests: 80 },
    },
  );
}
