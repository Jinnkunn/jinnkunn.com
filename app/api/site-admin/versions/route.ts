import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import {
  getSiteAdminSourceStore,
  isSiteAdminSourceConflictError,
} from "@/lib/server/site-admin-source-store";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import type { ParseResult } from "@/lib/site-admin/request-types";
import { normalizeSiteAdminVersionPath } from "@/lib/site-admin/version-path";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-versions", maxRequests: 40 };

type RestoreCommand = {
  path: string;
  commitSha: string;
  expectedFileSha?: string;
};

function parseRestoreCommand(
  body: Record<string, unknown>,
): ParseResult<RestoreCommand> {
  const path = normalizeSiteAdminVersionPath(body.path);
  const commitSha = typeof body.commitSha === "string" ? body.commitSha.trim() : "";
  const expectedFileSha =
    typeof body.expectedFileSha === "string" ? body.expectedFileSha.trim() : undefined;
  if (!path) return { ok: false, error: "unsupported content path", status: 400 };
  if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) {
    return { ok: false, error: "commitSha is invalid", status: 400 };
  }
  return { ok: true, value: { path, commitSha, expectedFileSha } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const url = new URL(req.url);
      const path = normalizeSiteAdminVersionPath(url.searchParams.get("path"));
      const commitSha = String(url.searchParams.get("commitSha") || "").trim();
      const limitRaw = Number(url.searchParams.get("limit") || "12");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 12;
      if (!path) {
        return apiError("unsupported content path", {
          status: 400,
          code: "BAD_REQUEST",
        });
      }
      const store = getSiteAdminSourceStore();
      if (commitSha && !/^[a-f0-9]{7,40}$/i.test(commitSha)) {
        return apiError("commitSha is invalid", { status: 400, code: "BAD_REQUEST" });
      }
      const [current, history, version] = await Promise.all([
        store.readTextFile(path),
        store.listTextFileHistory(path, limit),
        commitSha ? store.readTextFileAtCommit(path, commitSha) : Promise.resolve(null),
      ]);
      return apiPayloadOk({
        path,
        sourceVersion: { fileSha: current?.sha ?? "" },
        history,
        version,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseRestoreCommand);
      if (!parsed.ok) return parsed.res;
      const { path, commitSha, expectedFileSha } = parsed.value;
      const store = getSiteAdminSourceStore();
      const version = await store.readTextFileAtCommit(path, commitSha);
      if (!version) {
        return apiError("version not found", {
          status: 404,
          code: "VERSION_NOT_FOUND",
        });
      }
      try {
        const write = await store.writeTextFile({
          relPath: path,
          content: version.content,
          expectedSha: expectedFileSha,
          message: `chore(site-admin): restore ${path} from ${commitSha.slice(0, 7)}`,
        });
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "versions.restore",
          endpoint: "/api/site-admin/versions",
          method: "POST",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: { path, commitSha, restoredFileSha: write.fileSha },
        });
        return apiPayloadOk({
          path,
          content: version.content,
          restoredFrom: {
            commitSha: version.commitSha,
            fileSha: version.sha,
          },
          sourceVersion: {
            fileSha: write.fileSha,
            commitSha: write.commitSha,
          },
        });
      } catch (err) {
        if (isSiteAdminSourceConflictError(err)) {
          return apiError("Source changed. Reload latest and try again.", {
            status: 409,
            code: "SOURCE_CONFLICT",
            extras: { currentSha: err.currentSha, expectedSha: err.expectedSha },
          });
        }
        throw err;
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
