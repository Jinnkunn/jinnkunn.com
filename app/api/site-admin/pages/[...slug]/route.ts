import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  deletePage,
  readPage,
  updatePage,
} from "@/lib/pages/store";
import { isValidPageSlug } from "@/lib/pages/slug";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-pages-item" };

type UpdatePageCommand = {
  source: string;
  version: string;
};

type DeletePageCommand = {
  version: string;
};

function parseUpdateCommand(
  body: Record<string, unknown>,
): ParseResult<UpdatePageCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim())
    return { ok: false, error: "source (MDX body) is required", status: 400 };
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version)
    return {
      ok: false,
      error: "version is required (current page sha) to detect conflicts",
      status: 400,
    };
  return { ok: true, value: { source, version } };
}

function parseDeleteCommand(
  body: Record<string, unknown>,
): ParseResult<DeletePageCommand> {
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version)
    return {
      ok: false,
      error: "version is required (current page sha) to detect conflicts",
      status: 400,
    };
  return { ok: true, value: { version } };
}

async function resolveSlug(
  params: Promise<{ slug: string[] }>,
): Promise<{ ok: true; slug: string } | { ok: false; res: Response }> {
  const { slug } = await params;
  // Catch-all delivers slug as an array of path segments. Join into the
  // canonical "/"-separated form, then validate against the multi-segment
  // page-slug rule.
  const joined = Array.isArray(slug) ? slug.map((s) => String(s).trim()).join("/") : "";
  if (!joined || !isValidPageSlug(joined)) {
    return {
      ok: false,
      res: apiError("invalid slug", { status: 400, code: "BAD_REQUEST" }),
    };
  }
  return { ok: true, slug: joined };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  return withSiteAdminContext(
    req,
    async () => {
      const resolved = await resolveSlug(ctx.params);
      if (!resolved.ok) return resolved.res;
      const detail = await readPage(resolved.slug);
      if (!detail)
        return apiError("page not found", { status: 404, code: "NOT_FOUND" });
      return apiPayloadOk({
        slug: detail.entry.slug,
        href: detail.entry.href,
        title: detail.entry.title,
        description: detail.entry.description,
        updatedIso: detail.entry.updatedIso,
        draft: detail.entry.draft,
        wordCount: detail.entry.wordCount,
        readingMinutes: detail.entry.readingMinutes,
        version: detail.version,
        source: detail.source,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  return withSiteAdminContext(
    req,
    async (actor) => {
      const resolved = await resolveSlug(ctx.params);
      if (!resolved.ok) return resolved.res;
      const parsed = await readSiteAdminJsonCommand(req, parseUpdateCommand);
      if (!parsed.ok) return parsed.res;
      const { source, version } = parsed.value;
      let result: "success" | "source_conflict" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 200;
      try {
        const detail = await updatePage(resolved.slug, source, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "pages.update",
          endpoint: `/api/site-admin/pages/${resolved.slug}`,
          method: "PATCH",
          status,
          result,
          code,
          message,
          metadata: { slug: resolved.slug, version },
        });
        return apiPayloadOk({
          slug: detail.entry.slug,
          href: detail.entry.href,
          title: detail.entry.title,
          draft: detail.entry.draft,
          version: detail.version,
        });
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          message =
            "Page was modified since you last loaded it. Reload and re-apply your changes.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = "page not found";
          status = 404;
        } else {
          result = "error";
          code = "PAGE_UPDATE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 400;
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "pages.update",
          endpoint: `/api/site-admin/pages/${resolved.slug}`,
          method: "PATCH",
          status,
          result,
          code,
          message,
          metadata: { slug: resolved.slug, version },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  return withSiteAdminContext(
    req,
    async (actor) => {
      const resolved = await resolveSlug(ctx.params);
      if (!resolved.ok) return resolved.res;
      const parsed = await readSiteAdminJsonCommand(req, parseDeleteCommand);
      if (!parsed.ok) return parsed.res;
      const { version } = parsed.value;
      let result: "success" | "source_conflict" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 200;
      try {
        await deletePage(resolved.slug, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "pages.delete",
          endpoint: `/api/site-admin/pages/${resolved.slug}`,
          method: "DELETE",
          status,
          result,
          code,
          message,
          metadata: { slug: resolved.slug, version },
        });
        return apiPayloadOk({ slug: resolved.slug });
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          message = "Page changed since you last loaded it. Reload and retry.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = "page not found";
          status = 404;
        } else {
          result = "error";
          code = "PAGE_DELETE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 400;
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "pages.delete",
          endpoint: `/api/site-admin/pages/${resolved.slug}`,
          method: "DELETE",
          status,
          result,
          code,
          message,
          metadata: { slug: resolved.slug, version },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
