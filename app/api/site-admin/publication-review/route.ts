import type { NextRequest } from "next/server";
import { apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { loadPublicationReview } from "@/lib/server/publication-review-service";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  return withSiteAdminContext(req, async () => apiPayloadOk(await loadPublicationReview()), {
    requireAllowlist: true, requireAuthSecret: true,
    rateLimit: { namespace: "site-admin-publication-review", maxRequests: 60 },
  });
}
