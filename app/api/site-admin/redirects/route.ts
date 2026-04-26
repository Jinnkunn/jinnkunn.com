import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import { deleteRedirect, readRedirects, type RedirectKind } from "@/lib/redirects";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-redirects" };

const ALLOWED_KINDS: ReadonlyArray<RedirectKind> = ["pages", "posts"];

interface DeleteRedirectCommand {
  kind: RedirectKind;
  fromSlug: string;
}

function parseDeleteCommand(
  body: Record<string, unknown>,
): ParseResult<DeleteRedirectCommand> {
  const kindRaw = typeof body.kind === "string" ? body.kind : "";
  if (!ALLOWED_KINDS.includes(kindRaw as RedirectKind)) {
    return { ok: false, error: "invalid kind", status: 400 };
  }
  const fromSlug = typeof body.fromSlug === "string" ? body.fromSlug.trim() : "";
  if (!fromSlug) {
    return { ok: false, error: "fromSlug is required", status: 400 };
  }
  return { ok: true, value: { kind: kindRaw as RedirectKind, fromSlug } };
}

// GET /api/site-admin/redirects → { pages: {...}, posts: {...} }
//
// Returns the full content/redirects.json table. Each entry is one
// {oldSlug → newSlug} mapping that next.config.mjs reads at build time
// to emit a 308. The admin UI uses this to render a deletable list.
export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const table = await readRedirects();
      return apiPayloadOk({
        pages: table.pages,
        posts: table.posts,
        count:
          Object.keys(table.pages).length + Object.keys(table.posts).length,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

// DELETE /api/site-admin/redirects { kind, fromSlug }
//
// Drops one entry from the manifest. Idempotent — missing entries
// resolve as success. Use when an old slug is genuinely retired and
// no longer worth redirecting (or the redirect was created by mistake).
export async function DELETE(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (actor) => {
      const parsed = await readSiteAdminJsonCommand(req, parseDeleteCommand);
      if (!parsed.ok) return parsed.res;
      const { kind, fromSlug } = parsed.value;
      try {
        await deleteRedirect(kind, fromSlug);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "redirects.delete",
          endpoint: `/api/site-admin/redirects`,
          method: "DELETE",
          status: 200,
          result: "success",
          code: "OK",
          message: "",
          metadata: { kind, fromSlug },
        });
        return apiPayloadOk({ kind, fromSlug });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unexpected error";
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "redirects.delete",
          endpoint: `/api/site-admin/redirects`,
          method: "DELETE",
          status: 400,
          result: "error",
          code: "REDIRECT_DELETE_FAILED",
          message,
          metadata: { kind, fromSlug },
        });
        return apiError(message, {
          status: 400,
          code: "REDIRECT_DELETE_FAILED",
        });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
