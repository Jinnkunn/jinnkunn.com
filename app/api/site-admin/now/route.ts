import type { NextRequest } from "next/server";

import {
  NOW_CONTEXT_MAX_LENGTH,
  NOW_LOCATION_MAX_LENGTH,
  NOW_STATUS_MAX_LENGTH,
} from "@/lib/site-admin/now-normalize";
import { SiteAdminNowHistoryNotFoundError } from "@/lib/site-admin/now-commands";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  appendSiteAdminNowUpdate,
  deleteSiteAdminNowHistory,
  loadSiteAdminNowData,
  updateSiteAdminNowHistory,
} from "@/lib/server/site-admin-now-service";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-now" };

type NowUpdateCommand =
  | {
      action: "create";
      text: string;
      context: { hasValue: boolean; value?: string };
      location: { hasValue: boolean; value?: string };
      date?: string;
      expectedFileSha?: string;
    }
  | {
      action: "update-history";
      id: string;
      text: string;
      date?: string;
      expectedFileSha?: string;
    }
  | {
      action: "delete-history";
      id: string;
      expectedFileSha?: string;
    };

function trimString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function hasKey(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function readOptionalDate(raw: Record<string, unknown>): string | undefined {
  return typeof raw.date === "string" ? raw.date.trim() || undefined : undefined;
}

function readExpectedFileSha(raw: Record<string, unknown>): string | undefined {
  return typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;
}

function parseText(raw: Record<string, unknown>):
  | { ok: true; text: string }
  | { ok: false; error: string; status: number } {
  const text = trimString(raw.text);
  if (!text) return { ok: false, error: "Missing `text`", status: 400 };
  if (text.length > NOW_STATUS_MAX_LENGTH) {
    return {
      ok: false,
      error: `Status is too long. Keep it under ${NOW_STATUS_MAX_LENGTH} characters.`,
      status: 400,
    };
  }
  return { ok: true, text };
}

function parseNowUpdateCommand(raw: Record<string, unknown>):
  | { ok: true; value: NowUpdateCommand }
  | { ok: false; error: string; status: number } {
  const actionRaw = typeof raw.action === "string" ? raw.action.trim() : "";
  const action = actionRaw || "create";
  const expectedFileSha = readExpectedFileSha(raw);

  if (action === "update-history") {
    const id = trimString(raw.id);
    if (!id) return { ok: false, error: "Missing `id`", status: 400 };
    const text = parseText(raw);
    if (!text.ok) return text;
    return {
      ok: true,
      value: {
        action,
        id,
        text: text.text,
        date: readOptionalDate(raw),
        expectedFileSha,
      },
    };
  }

  if (action === "delete-history") {
    const id = trimString(raw.id);
    if (!id) return { ok: false, error: "Missing `id`", status: 400 };
    return {
      ok: true,
      value: {
        action,
        id,
        expectedFileSha,
      },
    };
  }

  if (action !== "create") {
    return { ok: false, error: `Unsupported Now action: ${action}`, status: 400 };
  }

  const text = parseText(raw);
  if (!text.ok) return text;
  const context = trimString(raw.context);
  if (context.length > NOW_CONTEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Context is too long. Keep it under ${NOW_CONTEXT_MAX_LENGTH} characters.`,
      status: 400,
    };
  }
  const location = trimString(raw.location);
  if (location.length > NOW_LOCATION_MAX_LENGTH) {
    return {
      ok: false,
      error: `Location is too long. Keep it under ${NOW_LOCATION_MAX_LENGTH} characters.`,
      status: 400,
    };
  }
  return {
    ok: true,
    value: {
      action,
      text: text.text,
      context: { hasValue: hasKey(raw, "context"), value: context },
      location: { hasValue: hasKey(raw, "location"), value: location },
      date: readOptionalDate(raw),
      expectedFileSha,
    },
  };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        const { data, sourceVersion } = await loadSiteAdminNowData();
        return apiPayloadOk({
          data,
          sourceVersion,
        });
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
      const parsed = await readSiteAdminJsonCommand(req, parseNowUpdateCommand);
      if (!parsed.ok) return parsed.res;
      const command = parsed.value;

      try {
        const result =
          command.action === "update-history"
            ? await updateSiteAdminNowHistory({
                id: command.id,
                text: command.text,
                date: command.date,
                expectedFileSha: command.expectedFileSha,
              })
            : command.action === "delete-history"
              ? await deleteSiteAdminNowHistory({
                  id: command.id,
                  expectedFileSha: command.expectedFileSha,
                })
              : await appendSiteAdminNowUpdate({
                  text: command.text,
                  context: command.context,
                  location: command.location,
                  date: command.date,
                  expectedFileSha: command.expectedFileSha,
                });
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action:
            command.action === "update-history"
              ? "now.history.update"
              : command.action === "delete-history"
                ? "now.history.delete"
                : "now.save",
          endpoint: "/api/site-admin/now",
          method: "POST",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: {},
        });
        return apiPayloadOk(result);
      } catch (err: unknown) {
        if (err instanceof SiteAdminNowHistoryNotFoundError) {
          await writeSiteAdminAuditLog({
            actor: ctx.login,
            action:
              command.action === "update-history"
                ? "now.history.update"
                : command.action === "delete-history"
                  ? "now.history.delete"
                  : "now.save",
            endpoint: "/api/site-admin/now",
            method: "POST",
            status: err.status,
            result: "not_found",
            code: err.code,
            message: err.message,
            metadata: { id: "id" in command ? command.id : "" },
          });
          return apiError(err.message, { status: err.status, code: err.code });
        }
        if (isSiteAdminSourceConflictError(err)) {
          await writeSiteAdminAuditLog({
            actor: ctx.login,
            action:
              command.action === "update-history"
                ? "now.history.update"
                : command.action === "delete-history"
                  ? "now.history.delete"
                  : "now.save",
            endpoint: "/api/site-admin/now",
            method: "POST",
            status: 409,
            result: "source_conflict",
            code: err.code,
            message: err.message,
            metadata: { expectedSha: err.expectedSha, currentSha: err.currentSha },
          });
          return apiError(err.message, { status: 409, code: err.code });
        }
        const msg = err instanceof Error ? err.message : String(err);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action:
            command.action === "update-history"
              ? "now.history.update"
              : command.action === "delete-history"
                ? "now.history.delete"
                : "now.save",
          endpoint: "/api/site-admin/now",
          method: "POST",
          status: 500,
          result: "error",
          code: "REQUEST_FAILED",
          message: msg,
          metadata: {},
        });
        return apiError(msg, { status: 500, code: "REQUEST_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
