import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { writePublicCalendarToDb } from "@/lib/server/public-calendar-db";
import { normalizePublicCalendarData } from "@/lib/shared/public-calendar";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = {
  namespace: "site-admin-calendar-public-live",
  maxRequests: 120,
  windowMs: 60 * 1000,
};

type SaveLiveCalendarCommand = {
  data: ReturnType<typeof normalizePublicCalendarData>;
};

function parseSaveCommand(
  raw: Record<string, unknown>,
): ParseResult<SaveLiveCalendarCommand> {
  return {
    ok: true,
    value: { data: normalizePublicCalendarData(raw.data ?? raw) },
  };
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseSaveCommand);
      if (!parsed.ok) return parsed.res;

      const result = await writePublicCalendarToDb(parsed.value.data);
      if (!result.ok || result.skipped) {
        const error = result.ok
          ? "Production calendar database is not configured."
          : result.error;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.public.live.save",
          endpoint: "/api/site-admin/calendar-public/live",
          method: "POST",
          status: 500,
          result: "error",
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
          message: error,
          metadata: {
            count: parsed.value.data.events.length,
          },
        });
        return apiError(error, {
          status: 500,
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
        });
      }

      try {
        revalidatePath("/calendar");
        revalidatePath("/api/public/calendar");
        revalidatePath("/api/public/calendar/calendar.ics");
      } catch {
        // The public API uses bounded caching as a second line of defense.
      }

      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "calendar.public.live.save",
        endpoint: "/api/site-admin/calendar-public/live",
        method: "POST",
        status: 200,
        result: "success",
        code: "OK",
        metadata: {
          count: parsed.value.data.events.length,
          eventsWritten: result.eventsWritten,
        },
      });

      return apiPayloadOk({
        eventCount: parsed.value.data.events.length,
        eventsWritten: result.eventsWritten,
        updatedAt: new Date().toISOString(),
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}
