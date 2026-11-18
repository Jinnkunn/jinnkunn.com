import type { NextRequest } from "next/server";
import { apiError, apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { loadPublicationReview } from "@/lib/server/publication-review-service";
import { ALL_PUBLICATION_SCOPE, validPublicationScope } from "@/lib/shared/publication-scope";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  return withSiteAdminContext(req, async () => {
    const scope = req.nextUrl.searchParams.get("scope") ?? ALL_PUBLICATION_SCOPE;
    if (!validPublicationScope(scope)) return apiError("Invalid publication selection.", { status: 400, code: "PUBLICATION_SCOPE_INVALID" });
    try { return apiPayloadOk(await loadPublicationReview(scope)); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("PUBLICATION_SCOPE_CHANGED:")) {
        return apiError(error.message.replace(/^PUBLICATION_SCOPE_CHANGED: /, ""), { status: 409, code: "PUBLICATION_SCOPE_CHANGED" });
      }
      throw error;
    }
  }, {
    requireAllowlist: true, requireAuthSecret: true,
    rateLimit: { namespace: "site-admin-publication-review", maxRequests: 60 },
  });
}
