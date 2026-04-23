import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import {
  getSiteAdminConfigBackend,
  postSiteAdminConfigBackend,
} from "@/lib/server/site-admin-backend-service";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { parseSiteAdminConfigCommand } from "@/lib/server/site-admin-request";
import type {
  SiteAdminConfigGetPayload,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-config" };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const out = await getSiteAdminConfigBackend();
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      const data = out.data;
      return apiPayloadOk<Omit<SiteAdminConfigGetPayload, "ok">>(data);
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminConfigCommand);
      if (!parsedCommand.ok) return parsedCommand.res;
      const command = parsedCommand.value;
      const out = await postSiteAdminConfigBackend(command);
      const isConflict = !out.ok && out.code === "SOURCE_CONFLICT";
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "config.save",
        endpoint: "/api/site-admin/config",
        method: "POST",
        status: out.ok ? 200 : out.status,
        result: out.ok ? "success" : isConflict ? "source_conflict" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: {
          kind: command.kind,
          rowId:
            command.kind === "settings" || command.kind === "nav-update"
              ? command.rowId
              : null,
        },
      });

      if (!out.ok) {
        return apiError(out.error, { status: out.status, code: out.code });
      }

      return apiPayloadOk(out.data);
    },
    { rateLimit: RATE_LIMIT },
  );
}
