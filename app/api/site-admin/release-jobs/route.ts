import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  createReleaseJob,
  getReleaseRunnerStatus,
  listReleaseJobs,
  listReleaseJobActions,
} from "@/lib/server/release-jobs-service";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-jobs", maxRequests: 40 };

function parseCreateJob(body: Record<string, unknown>): ParseResult<{
  action: unknown;
  request: Record<string, unknown>;
}> {
  const action = body.action;
  const request =
    body.request && typeof body.request === "object" && !Array.isArray(body.request)
      ? (body.request as Record<string, unknown>)
      : {};
  return { ok: true, value: { action, request } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const url = new URL(req.url);
      const limit = Number(url.searchParams.get("limit") || "20");
      const out = await listReleaseJobs({ limit });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      const runners = await getReleaseRunnerStatus();
      if (!runners.ok) {
        return apiError(runners.error, {
          status: runners.status,
          code: runners.code,
        });
      }
      return apiPayloadOk({
        jobs: out.data.jobs,
        runners: runners.data,
        actions: listReleaseJobActions(),
      });
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseCreateJob);
      if (!parsed.ok) return parsed.res;
      const out = await createReleaseJob({
        action: parsed.value.action,
        actor: ctx.login,
        request: parsed.value.request,
      });
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "release.job.create",
        endpoint: "/api/site-admin/release-jobs",
        method: "POST",
        status: out.ok ? 202 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: out.ok ? { jobId: out.data.id, action: out.data.action } : {},
      });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk({ job: out.data }, { status: 202 });
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}
