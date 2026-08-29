import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  cleanupCalendarCollectorObservations,
  publishCalendarObservationsToLive,
  readCalendarSyncHealth,
  writeCalendarObservationSync,
} from "@/lib/server/calendar-sync-store";
import { normalizeCalendarObservationSyncPayload } from "@jinnkunn/calendar-core/core";
import { parseCalendarCollectorCleanupCommand } from "@/lib/site-admin/calendar-observation-commands";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = {
  namespace: "site-admin-calendar-observations",
  maxRequests: 120,
  windowMs: 60 * 1000,
};
const CLEANUP_RATE_LIMIT = {
  namespace: "site-admin-calendar-observations-cleanup",
  maxRequests: 30,
  windowMs: 60 * 1000,
};
const CALENDAR_OBSERVATION_SYNC_MAX_BYTES = 4 * 1024 * 1024;
const CALENDAR_OBSERVATION_CLEANUP_MAX_BYTES = 4 * 1024;

async function publishLiveAfterObservationMutation(
  actor: string,
  trigger: "sync" | "cleanup",
) {
  const result = await publishCalendarObservationsToLive();
  if (!result.ok || result.skipped) {
    const reason = result.ok ? result.reason : result.error;
    await writeSiteAdminAuditLog({
      actor,
      action: "calendar.observations.publish-live",
      endpoint: "/api/site-admin/calendar-observations",
      method: trigger === "sync" ? "POST" : "DELETE",
      status: result.ok ? 200 : 502,
      result: result.ok ? "success" : "error",
      code: result.ok ? "LIVE_DB_NOT_CONFIGURED" : "LIVE_DB_WRITE_FAILED",
      message: reason,
      metadata: { trigger },
    });
    return result;
  }

  await writeSiteAdminAuditLog({
    actor,
    action: "calendar.observations.publish-live",
    endpoint: "/api/site-admin/calendar-observations",
    method: trigger === "sync" ? "POST" : "DELETE",
    status: 200,
    result: "success",
    code: "OK",
    metadata: {
      trigger,
      rowsWritten: result.rowsWritten,
      rowsDeleted: result.rowsDeleted,
      tables: result.tables,
    },
  });
  return result;
}

function revalidatePublicCalendar() {
  try {
    revalidatePath("/calendar");
    revalidatePath("/api/public/calendar");
    revalidatePath("/api/public/calendar/calendar.ics");
  } catch {
    // Public calendar responses also have bounded cache lifetimes.
  }
}

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
        { maxBytes: CALENDAR_OBSERVATION_SYNC_MAX_BYTES },
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

      const livePublish = await publishLiveAfterObservationMutation(
        ctx.login,
        "sync",
      );
      if (!livePublish.ok) {
        return apiError(
          "Calendar observations reached staging, but the Live calendar update failed. Retrying is safe.",
          { status: 502, code: "LIVE_DB_WRITE_FAILED" },
        );
      }
      revalidatePublicCalendar();

      return apiPayloadOk({
        sourcesWritten: result.sourcesWritten,
        observationsWritten: result.observationsWritten,
        entitiesWritten: result.entitiesWritten,
        staleObservations: result.staleObservations,
        syncedAt: parsed.value.observedAt,
        livePublish: livePublish.skipped
          ? { status: "not_configured", reason: livePublish.reason }
          : {
              status: "published",
              rowsWritten: livePublish.rowsWritten,
              rowsDeleted: livePublish.rowsDeleted,
              publishedAt: livePublish.publishedAt,
            },
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

/**
 * Tombstone only one authenticated collector's observations. Omitting `range`
 * means all observations ever reported by that collector; supplying it limits
 * cleanup to events overlapping the normalized half-open interval.
 */
export async function DELETE(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(
        req,
        parseCalendarCollectorCleanupCommand,
        { maxBytes: CALENDAR_OBSERVATION_CLEANUP_MAX_BYTES },
      );
      if (!parsed.ok) return parsed.res;

      const result = await cleanupCalendarCollectorObservations(parsed.value);
      if (!result.ok || result.skipped) {
        const error = result.ok
          ? "Calendar sync database is not configured."
          : result.error;
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "calendar.observations.cleanup",
          endpoint: "/api/site-admin/calendar-observations",
          method: "DELETE",
          status: 500,
          result: "error",
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
          message: error,
          metadata: {
            collectorId: parsed.value.collectorId,
            range: parsed.value.range ?? null,
          },
        });
        return apiError(error, {
          status: 500,
          code: result.ok ? "DB_NOT_CONFIGURED" : "DB_WRITE_FAILED",
        });
      }

      const livePublish = await publishLiveAfterObservationMutation(
        ctx.login,
        "cleanup",
      );
      if (!livePublish.ok) {
        return apiError(
          "Calendar cleanup reached staging, but the Live calendar update failed. Retrying is safe.",
          { status: 502, code: "LIVE_DB_WRITE_FAILED" },
        );
      }
      revalidatePublicCalendar();

      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "calendar.observations.cleanup",
        endpoint: "/api/site-admin/calendar-observations",
        method: "DELETE",
        status: 200,
        result: "success",
        code: "OK",
        metadata: {
          collectorId: result.collectorId,
          range: result.range,
          tombstonedObservations: result.tombstonedObservations,
          entitiesWritten: result.entitiesWritten,
        },
      });

      return apiPayloadOk({
        collectorId: result.collectorId,
        range: result.range,
        tombstonedObservations: result.tombstonedObservations,
        entitiesWritten: result.entitiesWritten,
        syncedAt: result.syncedAt,
        livePublish: livePublish.skipped
          ? { status: "not_configured", reason: livePublish.reason }
          : {
              status: "published",
              rowsWritten: livePublish.rowsWritten,
              rowsDeleted: livePublish.rowsDeleted,
              publishedAt: livePublish.publishedAt,
            },
      });
    },
    { rateLimit: CLEANUP_RATE_LIMIT },
  );
}
