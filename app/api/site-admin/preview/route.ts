import type { NextRequest } from "next/server";
import { createElement } from "react";

import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import {
  isMdxRuntimeCodeGenerationError,
  renderMdxPreviewHtml,
} from "@/lib/site-admin/mdx-preview-render";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-preview", maxRequests: 120 };

type PreviewCommand = {
  source: string;
};

function parseCommand(body: Record<string, unknown>): ParseResult<PreviewCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) {
    return { ok: false, error: "source is required", status: 400 };
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
        const element = createElement(Content, { components: postMdxComponents });
        // Dynamic import: Next.js 16 forbids top-level `react-dom/server` in
        // app route files. Node runtime resolves it fine at request time.
        const { renderToStaticMarkup } = await import("react-dom/server");
        const html = renderToStaticMarkup(element);
        return apiPayloadOk({ html });
      } catch (err) {
        if (isMdxRuntimeCodeGenerationError(err)) {
          return apiPayloadOk({
            html: renderMdxPreviewHtml(parsed.value.source),
            renderer: "static-mdx-preview",
          });
        }
        return apiError(
          err instanceof Error ? err.message : "MDX compile failed",
          { status: 400, code: "MDX_COMPILE_FAILED" },
        );
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
