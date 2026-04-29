import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";

// Backs the workspace "Promote to Production" button. Two methods, one
// purpose:
//
//   GET  -> read-only preflight: which SHA is on staging? what's main?
//           what's currently in production? It's safe to spam this for
//           the UI's "is the button green?" indicator.
//
//   POST -> same checks, then dispatch the `release-production`
//           Action via the existing GitHub App. Audited.
//
// All real logic lives in `promote-to-production-service`; this file
// stays a thin route wrapper to keep the auth/rate-limit boilerplate
// out of the way.

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-promote-to-production", maxRequests: 20 };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const { readPromotePreview } = await import(
        "@/lib/server/promote-to-production-service"
      );
      const preview = await readPromotePreview();
      // Preview is informational — even the "not ready" branches return
      // 200 so the UI can render the actual reason in its own panel
      // rather than parsing HTTP status codes.
      return apiPayloadOk({ preview });
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      rateLimit: RATE_LIMIT,
    },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const { readPromotePreview, dispatchPromoteToProduction } = await import(
        "@/lib/server/promote-to-production-service"
      );
      const preview = await readPromotePreview();
      if (!preview.ok) {
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "deploy.promote-to-production",
          endpoint: "/api/site-admin/promote-to-production",
          method: "POST",
          status: 409,
          result: "error",
          code: preview.code,
          message: preview.detail,
        });
        return apiError(preview.detail, { status: 409, code: preview.code });
      }
      const result = await dispatchPromoteToProduction({
        preview,
        triggeredBy: ctx.login,
      });
      if (!result.ok) {
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "deploy.promote-to-production",
          endpoint: "/api/site-admin/promote-to-production",
          method: "POST",
          status: result.status,
          result: "error",
          code: result.code,
          message: result.detail,
          metadata: {
            mainSha: preview.mainSha,
            stagingSha: preview.stagingSha,
          },
        });
        return apiError(result.detail, { status: result.status, code: result.code });
      }
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "deploy.promote-to-production",
        endpoint: "/api/site-admin/promote-to-production",
        method: "POST",
        status: 202,
        result: "success",
        code: "OK",
        message: "",
        metadata: {
          mainSha: preview.mainSha,
          stagingSha: preview.stagingSha,
          productionVersionBefore: preview.production?.versionId ?? "",
          dispatchedAt: result.dispatchedAt,
          runsListUrl: result.runsListUrl,
        },
      });
      return apiPayloadOk({
        ok: true,
        provider: result.provider,
        eventType: result.eventType,
        runsListUrl: result.runsListUrl,
        dispatchedAt: result.dispatchedAt,
        preview: result.preview,
      });
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      rateLimit: RATE_LIMIT,
    },
  );
}
