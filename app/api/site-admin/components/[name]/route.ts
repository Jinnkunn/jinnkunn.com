import type { NextRequest } from "next/server";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  isValidComponentName,
  readComponent,
  updateComponent,
  type ComponentName,
} from "@/lib/components/store";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-components-item" };

type UpdateComponentCommand = {
  source: string;
  version: string;
};

function parseUpdateCommand(
  body: Record<string, unknown>,
): ParseResult<UpdateComponentCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim())
    return { ok: false, error: "source (MDX body) is required", status: 400 };
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version)
    return {
      ok: false,
      error: "version is required (current component sha) to detect conflicts",
      status: 400,
    };
  return { ok: true, value: { source, version } };
}

async function resolveName(
  params: Promise<{ name: string }>,
): Promise<{ ok: true; name: ComponentName } | { ok: false; res: Response }> {
  const { name } = await params;
  const trimmed = String(name ?? "").trim();
  if (!isValidComponentName(trimmed)) {
    return {
      ok: false,
      res: apiError("invalid component name", {
        status: 400,
        code: "BAD_REQUEST",
      }),
    };
  }
  return { ok: true, name: trimmed };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  return withSiteAdminContext(
    req,
    async () => {
      const resolved = await resolveName(ctx.params);
      if (!resolved.ok) return resolved.res;
      const detail = await readComponent(resolved.name);
      if (!detail)
        return apiError("component not found", { status: 404, code: "NOT_FOUND" });
      return apiPayloadOk({
        name: detail.name,
        source: detail.source,
        version: detail.version,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  return withSiteAdminContext(
    req,
    async (actor) => {
      const resolved = await resolveName(ctx.params);
      if (!resolved.ok) return resolved.res;
      const parsed = await readSiteAdminJsonCommand(req, parseUpdateCommand);
      if (!parsed.ok) return parsed.res;
      const { source, version } = parsed.value;
      let result: "success" | "source_conflict" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 200;
      try {
        const detail = await updateComponent(resolved.name, source, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "components.update",
          endpoint: `/api/site-admin/components/${resolved.name}`,
          method: "PATCH",
          status,
          result,
          code,
          message,
          metadata: { name: resolved.name, version },
        });
        return apiPayloadOk({
          name: detail.name,
          version: detail.version,
        });
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          message =
            "Component was modified since you last loaded it. Reload and re-apply your changes.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = "component not found";
          status = 404;
        } else {
          result = "error";
          code = "COMPONENT_UPDATE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 400;
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "components.update",
          endpoint: `/api/site-admin/components/${resolved.name}`,
          method: "PATCH",
          status,
          result,
          code,
          message,
          metadata: { name: resolved.name, version },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
