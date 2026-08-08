import type { NextRequest } from "next/server";

import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import {
  isMdxRuntimeCodeGenerationError,
  renderMdxPreviewHtml,
} from "@/lib/site-admin/mdx-preview-render";
import type { ParseResult } from "@/lib/site-admin/request-types";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-mdx-preview", maxRequests: 180 };
const MAX_SOURCE_LENGTH = 200_000;

type PreviewMdxCommand = {
  source: string;
};

function parseCommand(body: Record<string, unknown>): ParseResult<PreviewMdxCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (source.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      error: "source is too large",
      status: 413,
    };
  }
  return { ok: true, value: { source } };
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      try {
        const { Content } = await compilePostMdx(parsed.value.source);
        const [{ createElement }, { renderToStaticMarkup }] = await Promise.all([
          import("react"),
          import("react-dom/server"),
        ]);
        const html = renderToStaticMarkup(
          createElement(Content, { components: postMdxComponents }),
        );
        return apiPayloadOk({
          html,
          renderer: "runtime-mdx-preview",
          approximate: false,
        });
      } catch (error) {
        if (!isMdxRuntimeCodeGenerationError(error)) {
          return apiError(
            error instanceof Error ? error.message : "MDX preview failed",
            { status: 400, code: "PREVIEW_FAILED" },
          );
        }
        return apiPayloadOk({
          html: renderMdxPreviewHtml(parsed.value.source),
          renderer: "static-mdx-preview",
          approximate: true,
        });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
