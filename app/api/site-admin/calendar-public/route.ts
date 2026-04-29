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
import { normalizePublicCalendarData } from "@/lib/shared/public-calendar";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-calendar-public" };

type SaveCalendarCommand = {
  data: ReturnType<typeof normalizePublicCalendarData>;
  expectedFileSha?: string;
};

function parseSaveCommand(
  raw: Record<string, unknown>,
): ParseResult<SaveCalendarCommand> {
  const data = normalizePublicCalendarData(raw.data ?? raw);
  const expectedFileSha =
    typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;
  return { ok: true, value: { data, expectedFileSha } };
}

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
      const parsed = await readSiteAdminJsonCommand(req, parseSaveCommand);
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
          return apiError(err.message, { status: 409, code: err.code });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return apiError(msg, { status: 400, code: "CALENDAR_PUBLIC_SAVE_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
