import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { retryReleaseJob } from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-job-retry", maxRequests: 40 };

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const { id } = await context.params;
      const out = await retryReleaseJob({ id, actor: ctx.login });
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "release.job.retry",
        endpoint: `/api/site-admin/release-jobs/${id}/retry`,
        method: "POST",
        status: out.ok ? 202 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: out.ok ? { jobId: out.data.id, retryOf: id, action: out.data.action } : {},
      });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk({ job: out.data, events: [] }, { status: 202 });
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}
