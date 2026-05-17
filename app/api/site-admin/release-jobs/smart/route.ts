import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  appendReleaseJobEvent,
  createReleaseJob,
} from "@/lib/server/release-jobs-service";
import { wakeReleaseRunnerForJob } from "@/lib/server/release-runner-wake";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-jobs-smart", maxRequests: 20 };

function parseSmartReleaseRequest(
  body: Record<string, unknown>,
): ParseResult<Record<string, unknown>> {
  const request =
    body.request && typeof body.request === "object" && !Array.isArray(body.request)
      ? (body.request as Record<string, unknown>)
      : {};
  return {
    ok: true,
    value: {
      ...request,
      source: typeof request.source === "string" ? request.source : "mobile",
    },
  };
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(
        req,
        parseSmartReleaseRequest,
        { invalidJsonError: "Invalid smart release request" },
      );
      if (!parsed.ok) return parsed.res;

      const out = await createReleaseJob({
        action: "smart-release",
        actor: ctx.login,
        request: parsed.value,
      });
      const wake = out.ok ? await wakeReleaseRunnerForJob(out.data) : null;
      if (out.ok && wake?.configured) {
        await appendReleaseJobEvent({
          id: out.data.id,
          phase: "wake",
          stream: wake.ok ? "status" : "stderr",
          message: wake.ok
            ? "Mac mini runner wake request accepted."
            : `Mac mini runner wake failed: ${wake.error || `HTTP ${wake.status}`}`,
        }).catch(() => undefined);
      }

      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "release.job.smart",
        endpoint: "/api/site-admin/release-jobs/smart",
        method: "POST",
        status: out.ok ? 202 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: out.ok ? { jobId: out.data.id, wake } : {},
      });

      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk({ job: out.data, wake }, { status: 202 });
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}
