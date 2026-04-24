import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  loadSiteAdminWorksData,
  normalizeWorksData,
  saveSiteAdminWorksData,
} from "@/lib/server/site-admin-works-service";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";
import type {
  SiteAdminWorksData,
  SiteAdminWorksGetPayload,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-works" };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        const { data, sourceVersion } = await loadSiteAdminWorksData();
        return apiPayloadOk<Omit<SiteAdminWorksGetPayload, "ok">>({
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

type PatchCommand = {
  data: SiteAdminWorksData;
  expectedFileSha?: string;
};

function parsePatchCommand(raw: Record<string, unknown>):
  | { ok: true; value: PatchCommand }
  | { ok: false; error: string; status: number } {
  const dataRaw = raw.data;
  if (!dataRaw || typeof dataRaw !== "object") {
    return { ok: false, error: "Missing `data` object", status: 400 };
  }
  const data = normalizeWorksData(dataRaw);
  const expectedFileSha =
    typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;
  return { ok: true, value: { data, expectedFileSha } };
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parsePatchCommand);
      if (!parsed.ok) return parsed.res;
      const { data, expectedFileSha } = parsed.value;

      try {
        const result = await saveSiteAdminWorksData({ data, expectedFileSha });
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "works.save",
          endpoint: "/api/site-admin/works",
          method: "POST",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: { entryCount: data.entries.length },
        });
        return apiPayloadOk({ sourceVersion: result });
      } catch (err: unknown) {
        if (isSiteAdminSourceConflictError(err)) {
          await writeSiteAdminAuditLog({
            actor: ctx.login,
            action: "works.save",
            endpoint: "/api/site-admin/works",
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
          action: "works.save",
          endpoint: "/api/site-admin/works",
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
