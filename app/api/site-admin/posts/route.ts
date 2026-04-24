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
  createPost,
  listPosts,
} from "@/lib/posts/store";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-posts" };

type CreatePostCommand = {
  slug: string;
  source: string;
};

function parseCreateCommand(
  body: Record<string, unknown>,
): ParseResult<CreatePostCommand> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return { ok: false, error: "slug is required", status: 400 };
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim())
    return { ok: false, error: "source (MDX body) is required", status: 400 };
  return { ok: true, value: { slug, source } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const url = new URL(req.url);
      const includeDrafts = url.searchParams.get("drafts") === "1";
      const items = await listPosts({ includeDrafts });
      return apiPayloadOk({
        count: items.length,
        posts: items.map(({ entry, version }) => ({
          slug: entry.slug,
          href: entry.href,
          title: entry.title,
          dateIso: entry.dateIso,
          dateText: entry.dateText,
          description: entry.description,
          draft: entry.draft,
          tags: entry.tags,
          wordCount: entry.wordCount,
          readingMinutes: entry.readingMinutes,
          version,
        })),
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseCreateCommand);
      if (!parsed.ok) return parsed.res;
      const { slug, source } = parsed.value;

      let result: "success" | "source_conflict" | "error" = "success";
      let code = "OK";
      let errorMessage = "";
      let responseStatus = 201;
      try {
        const detail = await createPost(slug, source);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "posts.create",
          endpoint: "/api/site-admin/posts",
          method: "POST",
          status: responseStatus,
          result: "success",
          code: "OK",
          message: "",
          metadata: { slug },
        });
        return apiPayloadOk(
          {
            slug: detail.entry.slug,
            href: detail.entry.href,
            version: detail.version,
            title: detail.entry.title,
            dateIso: detail.entry.dateIso,
            draft: detail.entry.draft,
          },
          { status: responseStatus },
        );
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          errorMessage = "A post with this slug already exists.";
          responseStatus = 409;
        } else {
          result = "error";
          code = "POST_CREATE_FAILED";
          errorMessage = err instanceof Error ? err.message : "unexpected error";
          responseStatus = 400;
        }
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "posts.create",
          endpoint: "/api/site-admin/posts",
          method: "POST",
          status: responseStatus,
          result,
          code,
          message: errorMessage,
          metadata: { slug },
        });
        return apiError(errorMessage, { status: responseStatus, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
