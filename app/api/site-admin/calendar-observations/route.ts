import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  readCalendarSyncHealth,
  writeCalendarObservationSync,
} from "@/lib/server/calendar-sync-store";
import { normalizeCalendarObservationSyncPayload } from "@/lib/shared/calendar-core";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = {
  namespace: "site-admin-calendar-observations",
  maxRequests: 120,
  windowMs: 60 * 1000,
};

function parseObservationSyncCommand(
  raw: Record<string, unknown>,
): ParseResult<ReturnType<typeof normalizeCalendarObservationSyncPayload>> {
  return { ok: true, value: normalizeCalendarObservationSyncPayload(raw) };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const health = await readCalendarSyncHealth();
      if (!health) {
        return apiError("Calendar sync database is not configured.", {
          status: 500,
          code: "DB_NOT_CONFIGURED",
        });
      }
      return apiPayloadOk({ health });
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
        parseObservationSyncCommand,
      );
      if (!parsed.ok) return parsed.res;

      const result = await writeCalendarObservationSync(parsed.value);
      if (!result.ok || result.skipped) {
        const error = result.ok
          ? "Calendar sync database is not configured."
          : result.error;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.observations.sync",
          endpoint: "/api/site-admin/calendar-observations",
          method: "POST",
          status: 500,
          result: "error",
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
          message: error,
          metadata: {
            collectorId: parsed.value.collector.id,
            sourceCount: parsed.value.sources.length,
            eventCount: parsed.value.observations.length,
          },
        });
        return apiError(error, {
          status: 500,
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
        });
      }

      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "calendar.observations.sync",
        endpoint: "/api/site-admin/calendar-observations",
        method: "POST",
        status: 200,
        result: "success",
        code: "OK",
        metadata: {
          collectorId: parsed.value.collector.id,
          sourceCount: result.sourcesWritten,
          eventCount: result.observationsWritten,
          entityCount: result.entitiesWritten,
          staleObservations: result.staleObservations,
        },
      });

      return apiPayloadOk({
        sourcesWritten: result.sourcesWritten,
        observationsWritten: result.observationsWritten,
        entitiesWritten: result.entitiesWritten,
        staleObservations: result.staleObservations,
        syncedAt: parsed.value.observedAt,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}
