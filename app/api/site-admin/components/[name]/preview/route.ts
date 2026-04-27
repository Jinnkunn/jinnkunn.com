import type { NextRequest } from "next/server";

import { renderComponentPreviewElement } from "@/lib/components/preview-render";
import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import {
  isMdxRuntimeCodeGenerationError,
  renderMdxPreviewHtml,
} from "@/lib/site-admin/mdx-preview-render";
import {
  isSiteComponentName,
  type SiteComponentName,
} from "@/lib/site-admin/component-registry";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-components-preview", maxRequests: 120 };

type PreviewComponentCommand = {
  limit?: number;
  source: string;
};

function parseCommand(
  body: Record<string, unknown>,
): ParseResult<PreviewComponentCommand> {
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) {
    return { ok: false, error: "source is required", status: 400 };
  }
  const rawLimit = body.limit;
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(50, Math.trunc(rawLimit))
      : undefined;
  return { ok: true, value: { source, limit } };
}

async function resolveName(
  params: Promise<{ name: string }>,
): Promise<{ ok: true; name: SiteComponentName } | { ok: false; res: Response }> {
  const { name } = await params;
  const trimmed = String(name ?? "").trim();
  if (!isSiteComponentName(trimmed)) {
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  return withSiteAdminContext(
    req,
    async () => {
      const resolved = await resolveName(ctx.params);
      if (!resolved.ok) return resolved.res;
      const parsed = await readSiteAdminJsonCommand(req, parseCommand);
      if (!parsed.ok) return parsed.res;
      try {
        const element = await renderComponentPreviewElement(
          resolved.name,
          parsed.value.source,
          parsed.value.limit,
        );
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
          err instanceof Error ? err.message : "Component preview failed",
          { status: 400, code: "COMPONENT_PREVIEW_FAILED" },
        );
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
