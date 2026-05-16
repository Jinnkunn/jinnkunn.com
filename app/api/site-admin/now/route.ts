import type { NextRequest } from "next/server";

import {
  NOW_CONTEXT_MAX_LENGTH,
  NOW_LOCATION_MAX_LENGTH,
  NOW_STATUS_MAX_LENGTH,
} from "@/lib/site-admin/now-normalize";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  appendSiteAdminNowUpdate,
  loadSiteAdminNowData,
} from "@/lib/server/site-admin-now-service";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-now" };

type NowUpdateCommand = {
  text: string;
  context: { hasValue: boolean; value?: string };
  location: { hasValue: boolean; value?: string };
  expectedFileSha?: string;
};

function trimString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function hasKey(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function parseNowUpdateCommand(raw: Record<string, unknown>):
  | { ok: true; value: NowUpdateCommand }
  | { ok: false; error: string; status: number } {
  const text = trimString(raw.text);
  if (!text) {
    return { ok: false, error: "Missing `text`", status: 400 };
  }
  if (text.length > NOW_STATUS_MAX_LENGTH) {
    return {
      ok: false,
      error: `Status is too long. Keep it under ${NOW_STATUS_MAX_LENGTH} characters.`,
      status: 400,
    };
  }
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
  const expectedFileSha =
    typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;
  return {
    ok: true,
    value: {
      text,
      context: { hasValue: hasKey(raw, "context"), value: context },
      location: { hasValue: hasKey(raw, "location"), value: location },
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
      const { text, context, location, expectedFileSha } = parsed.value;

      try {
        const result = await appendSiteAdminNowUpdate({
          text,
          context,
          location,
          expectedFileSha,
        });
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "now.save",
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
        if (isSiteAdminSourceConflictError(err)) {
          await writeSiteAdminAuditLog({
            actor: ctx.login,
            action: "now.save",
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
          action: "now.save",
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
