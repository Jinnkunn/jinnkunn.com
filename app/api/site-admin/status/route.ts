import type { NextRequest } from "next/server";

import { apiOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { buildSiteAdminStatusPayload } from "@/lib/server/site-admin-status-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const payload = await buildSiteAdminStatusPayload();
    return apiOk(payload);
  });
}
