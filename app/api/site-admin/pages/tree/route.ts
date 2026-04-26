import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  loadSiteAdminPageTreeData,
  saveSiteAdminPageTreeData,
} from "@/lib/server/site-admin-page-tree-service";
import { isSiteAdminSourceConflictError } from "@/lib/server/site-admin-source-store";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-pages-tree" };

type SavePageTreeCommand = {
  slugs: string[];
  expectedFileSha?: string;
};

function parseSaveCommand(
  raw: Record<string, unknown>,
): ParseResult<SavePageTreeCommand> {
  const slugs = raw.slugs;
  if (!Array.isArray(slugs)) {
    return { ok: false, error: "slugs must be an array", status: 400 };
  }
  const parsed = slugs.map((item) => (typeof item === "string" ? item.trim() : ""));
  const expectedFileSha =
    typeof raw.expectedFileSha === "string" ? raw.expectedFileSha : undefined;
  return { ok: true, value: { slugs: parsed, expectedFileSha } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      try {
        const { data, sourceVersion } = await loadSiteAdminPageTreeData();
        return apiPayloadOk({
          slugs: data.slugs,
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
      const parsed = await readSiteAdminJsonCommand(req, parseSaveCommand);
      if (!parsed.ok) return parsed.res;
      try {
        const sourceVersion = await saveSiteAdminPageTreeData(parsed.value);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "pages.tree.save",
          endpoint: "/api/site-admin/pages/tree",
          method: "POST",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: { count: parsed.value.slugs.length },
        });
        return apiPayloadOk({ sourceVersion });
      } catch (err: unknown) {
        if (isSiteAdminSourceConflictError(err)) {
          await writeSiteAdminAuditLog({
            actor: ctx.login,
            action: "pages.tree.save",
            endpoint: "/api/site-admin/pages/tree",
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
          action: "pages.tree.save",
          endpoint: "/api/site-admin/pages/tree",
          method: "POST",
          status: 400,
          result: "error",
          code: "PAGE_TREE_SAVE_FAILED",
          message: msg,
          metadata: {},
        });
        return apiError(msg, { status: 400, code: "PAGE_TREE_SAVE_FAILED" });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
