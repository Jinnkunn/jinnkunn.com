import type { NextRequest } from "next/server";
import type { ReactNode } from "react";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import { classicPreviewStylesheets } from "@/lib/server/classic-preview-styles";
import { isMdxRuntimeCodeGenerationError, renderMdxPreviewHtml } from "@/lib/site-admin/mdx-preview-render";
import { apiPayloadOk, readSiteAdminJsonCommand, withSiteAdminContext } from "@/lib/server/site-admin-api";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return withSiteAdminContext(req, async () => {
    const parsed = await readSiteAdminJsonCommand(req, (raw) => {
      if (typeof raw.source !== "string" || raw.source.length > 200_000) return { ok: false, error: "Invalid preview source", status: 400 };
      return { ok: true, value: { source: raw.source, title: String(raw.title || "Preview").slice(0, 500), home: raw.home === true } };
    });
    if (!parsed.ok) return parsed.res;
    const { source, title, home } = parsed.value;
    let body: ReactNode;
    let approximate = false;
    try {
      const { Content } = await compilePostMdx(source);
      body = <Content components={postMdxComponents} />;
    } catch (error) {
      if (!isMdxRuntimeCodeGenerationError(error)) throw error;
      approximate = true;
      body = <div dangerouslySetInnerHTML={{ __html: renderMdxPreviewHtml(source) }} />;
    }
    const { renderToStaticMarkup } = await import("react-dom/server");
    const renderPage = () => renderToStaticMarkup(<div className="super-root">
        <SiteNav staticPreview />
        <div id="content-wrapper" className="super-content-wrapper">
          <ClassicPageShell title={title} className={`super-content ${home ? "page__index parent-page__index" : "page__document"}`}>
            <div className="mdx-post__body">{body}</div>
          </ClassicPageShell>
        </div>
        <SiteFooter staticPreview />
      </div>);
    let html;
    try {
      html = renderPage();
    } catch (error) {
      // Client-only MDX blocks cannot execute inside this script-free preview.
      if (!(error instanceof Error) || !/but it's on the client|client module|suspended while responding/.test(error.message)) throw error;
      approximate = true;
      body = <div dangerouslySetInnerHTML={{ __html: renderMdxPreviewHtml(source) }} />;
      html = renderPage();
    }
    return apiPayloadOk({ html, approximate, stylesheets: classicPreviewStylesheets() });
  }, { requireAllowlist: true, requireAuthSecret: true, rateLimit: { namespace: "site-admin-page-preview", maxRequests: 120 } });
}
