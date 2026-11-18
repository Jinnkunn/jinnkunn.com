import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { publishCalendarObservationsToLive } from "@/lib/server/calendar-sync-store";
import { revalidatePublicCalendar } from "../revalidate";

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
      const rawRevision = req.nextUrl.searchParams.get("revision");
      const expectedRevision = rawRevision === null ? undefined : Number(rawRevision);
      if (expectedRevision !== undefined && (
        !/^[1-9]\d*$/.test(rawRevision ?? "") || !Number.isSafeInteger(expectedRevision)
      )) {
        return apiError("Invalid calendar revision.", {
          status: 400,
          code: "INVALID_CALENDAR_REVISION",
        });
      }
      const result = await publishCalendarObservationsToLive(undefined, undefined, 0, expectedRevision);
      if (!result.ok || result.skipped) {
        const reason = result.ok ? result.reason : result.error;
        const code = result.ok ? "LIVE_DB_NOT_CONFIGURED" : result.code ?? "LIVE_DB_WRITE_FAILED";
        const status = code === "CALENDAR_REVISION_CHANGED" ? 409 : 500;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.observations.publish-live",
          endpoint: "/api/site-admin/calendar-observations/publish-live",
          method: "POST",
          status,
          result: "error",
          code,
          message: reason,
        });
        return apiError(
          result.ok
            ? "Live calendar database binding is not configured."
            : result.error,
          { status, code },
        );
      }

      revalidatePublicCalendar();
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
