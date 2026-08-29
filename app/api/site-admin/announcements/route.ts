import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import {
  deleteSiteAdminAnnouncement,
  loadSiteAdminAnnouncements,
  SiteAdminAnnouncementNotFoundError,
  upsertSiteAdminAnnouncement,
} from "@/lib/server/site-admin-announcement-service";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";
import {
  normalizeAnnouncement,
  type SiteAnnouncement,
} from "@/lib/shared/announcements";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-announcements" };

type AnnouncementCommand =
  | { action: "upsert"; announcement: SiteAnnouncement; expectedFileSha?: string }
  | { action: "delete"; id: string; expectedFileSha?: string };

function parseCommand(raw: Record<string, unknown>):
  | { ok: true; value: AnnouncementCommand }
  | { ok: false; error: string; status: number } {
  const action = String(raw.action || "upsert").trim();
  const expectedFileSha =
    typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;

  if (action === "delete") {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    return id
      ? { ok: true, value: { action, id, expectedFileSha } }
      : { ok: false, error: "Missing `id`", status: 400 };
  }
  if (action !== "upsert") {
    return { ok: false, error: `Unsupported announcement action: ${action}`, status: 400 };
  }

  const announcement = normalizeAnnouncement(raw.announcement);
  if (!announcement) {
    return { ok: false, error: "Missing or invalid `announcement`", status: 400 };
  }
  if (!announcement.id || !announcement.title) {
    return { ok: false, error: "Announcement id and title are required", status: 400 };
  }
  if (announcement.status === "published" && !announcement.bodyMdx.trim()) {
    return { ok: false, error: "Published announcements need body content", status: 400 };
  }
  if (announcement.scope === "paths" && announcement.routes.length === 0) {
    return { ok: false, error: "Path-scoped announcements need at least one route", status: 400 };
  }
  return { ok: true, value: { action, announcement, expectedFileSha } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        return apiPayloadOk(await loadSiteAdminAnnouncements());
      } catch (error: unknown) {
        return apiError(error instanceof Error ? error.message : String(error), {
          status: 500,
          code: "REQUEST_FAILED",
        });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      const command = parsed.value;
      const action = command.action === "delete" ? "announcement.delete" : "announcement.save";

      try {
        const result =
          command.action === "delete"
            ? await deleteSiteAdminAnnouncement(command)
            : await upsertSiteAdminAnnouncement(command);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action,
          endpoint: "/api/site-admin/announcements",
          method: "POST",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: { id: command.action === "delete" ? command.id : command.announcement.id },
        });
        return apiPayloadOk(result);
      } catch (error: unknown) {
        const status =
          error instanceof SiteAdminAnnouncementNotFoundError
            ? error.status
            : isSiteAdminSourceConflictError(error)
              ? 409
              : 500;
        const code =
          error instanceof SiteAdminAnnouncementNotFoundError
            ? error.code
            : isSiteAdminSourceConflictError(error)
              ? error.code
              : "REQUEST_FAILED";
        const message = error instanceof Error ? error.message : String(error);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action,
          endpoint: "/api/site-admin/announcements",
          method: "POST",
          status,
          result: status === 409 ? "source_conflict" : "error",
          code,
          message,
          metadata: {},
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
