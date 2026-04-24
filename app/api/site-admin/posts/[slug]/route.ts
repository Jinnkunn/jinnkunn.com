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
  deletePost,
  readPost,
  updatePost,
} from "@/lib/posts/store";
import { isValidSlug } from "@/lib/posts/slug";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-posts-item" };

type UpdatePostCommand = {
  source: string;
  version: string;
};

type DeletePostCommand = {
  version: string;
};

function parseUpdateCommand(
  body: Record<string, unknown>,
): ParseResult<UpdatePostCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim())
    return { ok: false, error: "source (MDX body) is required", status: 400 };
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version)
    return {
      ok: false,
      error: "version is required (current post sha) to detect conflicts",
      status: 400,
    };
  return { ok: true, value: { source, version } };
}

function parseDeleteCommand(
  body: Record<string, unknown>,
): ParseResult<DeletePostCommand> {
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version)
    return {
      ok: false,
      error: "version is required (current post sha) to detect conflicts",
      status: 400,
    };
  return { ok: true, value: { version } };
}

async function resolveSlug(
  params: Promise<{ slug: string }>,
): Promise<{ ok: true; slug: string } | { ok: false; res: Response }> {
  const { slug } = await params;
  const trimmed = String(slug || "").trim();
  if (!trimmed || !isValidSlug(trimmed)) {
    return {
      ok: false,
      res: apiError("invalid slug", { status: 400, code: "BAD_REQUEST" }),
    };
  }
  return { ok: true, slug: trimmed };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  return withSiteAdminContext(
    req,
    async () => {
      const resolved = await resolveSlug(ctx.params);
      if (!resolved.ok) return resolved.res;
      const detail = await readPost(resolved.slug);
      if (!detail)
        return apiError("post not found", { status: 404, code: "NOT_FOUND" });
      return apiPayloadOk({
        slug: detail.entry.slug,
        href: detail.entry.href,
        title: detail.entry.title,
        dateIso: detail.entry.dateIso,
        dateText: detail.entry.dateText,
        description: detail.entry.description,
        draft: detail.entry.draft,
        tags: detail.entry.tags,
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
  ctx: { params: Promise<{ slug: string }> },
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
        const detail = await updatePost(resolved.slug, source, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.update",
          endpoint: `/api/site-admin/posts/${resolved.slug}`,
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
          dateIso: detail.entry.dateIso,
          draft: detail.entry.draft,
          version: detail.version,
        });
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          message =
            "Post was modified since you last loaded it. Reload and re-apply your changes.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = "post not found";
          status = 404;
        } else {
          result = "error";
          code = "POST_UPDATE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 400;
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.update",
          endpoint: `/api/site-admin/posts/${resolved.slug}`,
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
  ctx: { params: Promise<{ slug: string }> },
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
        await deletePost(resolved.slug, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.delete",
          endpoint: `/api/site-admin/posts/${resolved.slug}`,
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
          message = "Post changed since you last loaded it. Reload and retry.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = "post not found";
          status = 404;
        } else {
          result = "error";
          code = "POST_DELETE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 400;
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.delete",
          endpoint: `/api/site-admin/posts/${resolved.slug}`,
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
