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
  getReleaseRunnerStatus,
  listReleaseJobs,
  listReleaseJobActions,
} from "@/lib/server/release-jobs-service";
import { wakeReleaseRunnerForJob } from "@/lib/server/release-runner-wake";
import type { ParseResult } from "@/lib/site-admin/request-types";
import { loadPublishedSnapshot, loadSavedSnapshot } from "@/lib/server/publication-review-service";
import { publicationValidation } from "@/lib/shared/publication-validation";
import { ALL_PUBLICATION_SCOPE, validPublicationScope, publicationCandidate } from "@/lib/shared/publication-scope";

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
      const reviewed = parsed.value.request.reviewSnapshotSha;
      const scope = parsed.value.request.reviewScope ?? ALL_PUBLICATION_SCOPE;
      const baselineSha = parsed.value.request.reviewBaselineSha;
      const publishesContent = /^publish-content-(production|staging)$/.test(String(parsed.value.action));
      const target = new URL(req.url).hostname.startsWith("staging.") ? "staging" : "production";
      if (publishesContent && parsed.value.action !== `publish-content-${target}`) return apiError("Review belongs to a different environment.", { status: 400, code: "PUBLICATION_TARGET_MISMATCH" });
      if ((reviewed !== undefined && (!publishesContent || !/^[a-f0-9]{64}$/.test(String(reviewed)))) ||
          (baselineSha !== undefined && (!publishesContent || !/^[a-f0-9]{64}$/.test(String(baselineSha)))) ||
          !validPublicationScope(scope) || (scope !== ALL_PUBLICATION_SCOPE && (!publishesContent || !reviewed || !baselineSha))) {
        return apiError("Invalid publication review.", { status: 400, code: "INVALID_PUBLICATION_REVIEW" });
      }
      if (publishesContent) {
        const [saved, live] = await Promise.all([loadSavedSnapshot(), loadPublishedSnapshot()]);
        if (baselineSha && live.sha !== baselineSha) return apiError("Live content changed after review. Refresh before publishing.", { status: 409, code: "PUBLICATION_BASELINE_CHANGED" });
        let snapshot;
        try { snapshot = publicationCandidate(saved, live, scope); }
        catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("PUBLICATION_SCOPE_CHANGED:")) throw error;
          return apiError(error.message.replace(/^PUBLICATION_SCOPE_CHANGED: /, ""), { status: 409, code: "PUBLICATION_SCOPE_CHANGED" });
        }
        if (reviewed && snapshot.sha !== reviewed) return apiError("Selected saved content changed after review. Refresh before publishing.", { status: 409, code: "PUBLICATION_SNAPSHOT_CHANGED" });
        const validation = publicationValidation(snapshot.sources);
        if (validation.blockers.length) return apiError("Reviewed content needs attention before publication.", { status: 422, code: "PUBLICATION_VALIDATION_FAILED", extras: { issues: validation.blockers, snapshotSha: snapshot.sha } });
        parsed.value.request.reviewSnapshotSha = snapshot.sha;
        if (baselineSha) parsed.value.request.reviewBaselineSha = live.sha;
        parsed.value.request.reviewScope = scope;
      }
      const out = await createReleaseJob({
        action: parsed.value.action,
        actor: ctx.login,
        request: parsed.value.request,
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
        action: "release.job.create",
        endpoint: "/api/site-admin/release-jobs",
        method: "POST",
        status: out.ok ? 202 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: out.ok ? { jobId: out.data.id, action: out.data.action, wake } : {},
      });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk({ job: out.data, wake }, { status: 202 });
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}
