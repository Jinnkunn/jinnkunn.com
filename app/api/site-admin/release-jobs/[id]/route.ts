import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { getReleaseJob } from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-job", maxRequests: 80 };

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  return withSiteAdminContext(
    req,
    async () => {
      const { id } = await context.params;
      const out = await getReleaseJob({ id });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk(out.data);
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}

