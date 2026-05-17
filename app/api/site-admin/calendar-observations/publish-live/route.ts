import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { publishCalendarObservationsToLive } from "@/lib/server/calendar-sync-store";

export const runtime = "nodejs";

const RATE_LIMIT = {
  namespace: "site-admin-calendar-observations-publish-live",
  maxRequests: 30,
  windowMs: 60 * 1000,
};

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const result = await publishCalendarObservationsToLive();
      if (!result.ok || result.skipped) {
        const reason = result.ok ? result.reason : result.error;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.observations.publish-live",
          endpoint: "/api/site-admin/calendar-observations/publish-live",
          method: "POST",
          status: 500,
          result: "error",
          code: result.ok ? "LIVE_DB_NOT_CONFIGURED" : "LIVE_DB_WRITE_FAILED",
          message: reason,
        });
        return apiError(
          result.ok
            ? "Live calendar database binding is not configured."
            : result.error,
          {
            status: 500,
            code: result.ok ? "LIVE_DB_NOT_CONFIGURED" : "LIVE_DB_WRITE_FAILED",
          },
        );
      }

      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "calendar.observations.publish-live",
        endpoint: "/api/site-admin/calendar-observations/publish-live",
        method: "POST",
        status: 200,
        result: "success",
        code: "OK",
        metadata: {
          rowsWritten: result.rowsWritten,
          rowsDeleted: result.rowsDeleted,
          tables: result.tables,
        },
      });

      return apiPayloadOk({
        rowsWritten: result.rowsWritten,
        rowsDeleted: result.rowsDeleted,
        tables: result.tables,
        publishedAt: result.publishedAt,
      });
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      rateLimit: RATE_LIMIT,
    },
  );
}
