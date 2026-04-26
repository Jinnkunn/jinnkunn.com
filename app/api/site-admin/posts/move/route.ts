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
  movePost,
} from "@/lib/posts/store";
import { isValidSlug } from "@/lib/posts/slug";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-posts-move" };

interface MovePostCommand {
  fromSlug: string;
  toSlug: string;
  version: string;
}

function parseCommand(
  body: Record<string, unknown>,
): ParseResult<MovePostCommand> {
  const fromSlug = typeof body.fromSlug === "string" ? body.fromSlug.trim() : "";
  const toSlug = typeof body.toSlug === "string" ? body.toSlug.trim() : "";
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!fromSlug || !isValidSlug(fromSlug)) {
    return { ok: false, error: "invalid fromSlug", status: 400 };
  }
  if (!toSlug || !isValidSlug(toSlug)) {
    return { ok: false, error: "invalid toSlug", status: 400 };
  }
  if (fromSlug === toSlug) {
    return { ok: false, error: "fromSlug and toSlug are identical", status: 400 };
  }
  if (!version) {
    return {
      ok: false,
      error: "version is required (current post sha) to detect conflicts",
      status: 400,
    };
  }
  return { ok: true, value: { fromSlug, toSlug, version } };
}

// POST /api/site-admin/posts/move { fromSlug, toSlug, version }
//
// Renames a post — slugs stay flat (posts have no parent semantics).
// Mirrors /pages/move including the redirect side-effect (writes an
// entry into content/redirects.json so /blog/<oldSlug> 308s to the
// new slug after the next deploy).
export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (actor) => {
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      const { fromSlug, toSlug, version } = parsed.value;
      let result: "success" | "source_conflict" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 200;
      try {
        const detail = await movePost(fromSlug, toSlug, version);
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.move",
          endpoint: `/api/site-admin/posts/move`,
          method: "POST",
          status,
          result,
          code,
          message,
          metadata: { fromSlug, toSlug, version },
        });
        return apiPayloadOk({
          fromSlug,
          toSlug: detail.entry.slug,
          version: detail.version,
        });
      } catch (err) {
        if (err instanceof ContentStoreConflictError) {
          result = "source_conflict";
          code = "SOURCE_CONFLICT";
          message =
            "Post was modified since you last loaded it. Reload and retry the rename.";
          status = 409;
        } else if (err instanceof ContentStoreNotFoundError) {
          result = "error";
          code = "NOT_FOUND";
          message = `post not found at ${fromSlug}`;
          status = 404;
        } else {
          const raw = err instanceof Error ? err.message : "unexpected error";
          if (raw.includes("already exists")) {
            result = "error";
            code = "TARGET_EXISTS";
            message = `a post already exists at ${toSlug}`;
            status = 409;
          } else {
            result = "error";
            code = "POST_MOVE_FAILED";
            message = raw;
            status = 400;
          }
        }
        await writeSiteAdminAuditLog({
          actor: actor.login,
          action: "posts.move",
          endpoint: `/api/site-admin/posts/move`,
          method: "POST",
          status,
          result,
          code,
          message,
          metadata: { fromSlug, toSlug, version },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
