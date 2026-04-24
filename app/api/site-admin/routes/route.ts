import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import {
  getSiteAdminRoutesBackend,
  postSiteAdminRoutesBackend,
} from "@/lib/server/site-admin-backend-service";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  parseSiteAdminRoutesCommand,
} from "@/lib/server/site-admin-request";
import type {
  SiteAdminRoutesGetPayload,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

type SiteAdminRoutesResponsePayload = Omit<SiteAdminRoutesGetPayload, "ok">;

const RATE_LIMIT = { namespace: "site-admin-routes" };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const out = await getSiteAdminRoutesBackend();
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      const payload: SiteAdminRoutesResponsePayload = out.data;
      return apiPayloadOk<SiteAdminRoutesResponsePayload>(payload);
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminRoutesCommand);
      if (!parsedCommand.ok) return parsedCommand.res;
      const command = parsedCommand.value;
      const out = await postSiteAdminRoutesBackend(command);
      const isConflict = !out.ok && out.code === "SOURCE_CONFLICT";
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action:
          command.kind === "override" ? "routes.override.save" : "routes.protected.save",
        endpoint: "/api/site-admin/routes",
        method: "POST",
        status: out.ok ? 200 : out.status,
        result: out.ok ? "success" : isConflict ? "source_conflict" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
        metadata: {
          kind: command.kind,
          pageId: command.pageId,
          path: command.kind === "protected" ? command.path : null,
          routePath: command.kind === "override" ? command.routePath : null,
        },
      });

      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk(out.data);
    },
    { rateLimit: RATE_LIMIT },
  );
}
