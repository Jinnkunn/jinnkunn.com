import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { cancelReleaseJob } from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-job-cancel", maxRequests: 40 };

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const { id } = await context.params;
      const out = await cancelReleaseJob({ id, actor: ctx.login });
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "release.job.cancel",
        endpoint: `/api/site-admin/release-jobs/${id}/cancel`,
        method: "POST",
        status: out.ok ? 200 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: out.ok ? { jobId: out.data.job.id, status: out.data.job.status } : {},
      });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk(out.data);
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}
