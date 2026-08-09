import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  loadSiteAdminPublicCalendarData,
  saveSiteAdminPublicCalendarData,
} from "@/lib/server/site-admin-calendar-public-service";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";
import { parseSiteAdminCalendarPublicSaveCommand } from "@/lib/site-admin/calendar-public-commands";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-calendar-public" };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        const { data, sourceVersion } = await loadSiteAdminPublicCalendarData();
        return apiPayloadOk({ data, sourceVersion });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return apiError(msg, { status: 500, code: "REQUEST_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(
        req,
        parseSiteAdminCalendarPublicSaveCommand,
      );
      if (!parsed.ok) return parsed.res;
      try {
        const saved = await saveSiteAdminPublicCalendarData(parsed.value);
        const { dbStatus, dbError, ...sourceVersion } = saved;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.public.save",
          endpoint: "/api/site-admin/calendar-public",
          method: "POST",
          status: 200,
          result: dbStatus === "failed" ? "error" : "success",
          code: dbStatus === "failed" ? "DB_WRITE_FAILED" : "OK",
          message: dbError ?? "",
          metadata: {
            count: parsed.value.data.events.length,
            dbStatus,
          },
        });
        return apiPayloadOk({ sourceVersion, dbStatus });
      } catch (err: unknown) {
        if (isSiteAdminSourceConflictError(err)) {
          // Hand back both shas (as /versions and /live already do) so the
          // caller can re-read, merge and retry without a second round-trip.
          return apiError(err.message, {
            status: 409,
            code: err.code,
            extras: { expectedSha: err.expectedSha, currentSha: err.currentSha },
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return apiError(msg, { status: 400, code: "CALENDAR_PUBLIC_SAVE_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
