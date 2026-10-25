import type { NextRequest } from "next/server";
import type { ReactNode } from "react";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { renderAnnouncementPreview } from "@/components/site-admin/announcement-preview";
import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import { classicPreviewStylesheets } from "@/lib/server/classic-preview-styles";
import { isMdxRuntimeCodeGenerationError, renderMdxPreviewHtml } from "@/lib/site-admin/mdx-preview-render";
import { apiPayloadOk, readSiteAdminJsonCommand, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { loadPublishedSnapshot } from "@/lib/server/publication-review-service";
import { pagePreviewContext, resolvePreviewEmbeds } from "@/lib/site-admin/page-preview-context";
import { announcementInitiallyExpanded, normalizeAnnouncement } from "@/lib/shared/announcements";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return withSiteAdminContext(req, async () => {
    const parsed = await readSiteAdminJsonCommand(req, (raw) => {
      if (typeof raw.source !== "string" || raw.source.length > 200_000) return { ok: false, error: "Invalid preview source", status: 400 };
      const routePath = typeof raw.routePath === "string" && /^\/(?!\/)[a-z0-9/-]*$/i.test(raw.routePath) ? raw.routePath : raw.home === true ? "/" : "/preview";
      const announcement = raw.announcement ? normalizeAnnouncement(raw.announcement) : null;
      if (announcement && announcement.bodyMdx.length + announcement.compactMdx.length > 104_000) return { ok: false, error: "Announcement is too large", status: 400 };
      return { ok: true, value: { source: raw.source, title: String(raw.title || "Preview").slice(0, 500), home: raw.home === true, routePath, announcement, includeAnnouncement: raw.includeAnnouncement !== false, display: raw.display === "expanded" || raw.display === "compact" ? raw.display : "route" } };
    });
    if (!parsed.ok) return parsed.res;
    const { home, routePath, announcement, includeAnnouncement, display } = parsed.value;
    const snapshot = await loadPublishedSnapshot();
    const context = pagePreviewContext(snapshot.sources, routePath, announcement || undefined);
    let { source, title } = parsed.value;
    if (announcement && !source.trim()) {
      const page = home ? snapshot.sources["home.json"] : snapshot.sources[`pages/${routePath.replace(/^\/(pages\/)?/, "")}.mdx`];
      if (page && home) { const value = JSON.parse(page); source = String(value.bodyMdx || ""); title = String(value.title || title); }
      else if (page) source = page;
    }
    source = resolvePreviewEmbeds(source, snapshot.sources);
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
    const visibleAnnouncement = includeAnnouncement ? context.announcement : null;
    const expanded = visibleAnnouncement ? display === "expanded" || (display === "route" && announcementInitiallyExpanded(visibleAnnouncement, routePath === "/")) : false;
    const announcementContent = visibleAnnouncement ? await renderAnnouncementPreview({ announcement: visibleAnnouncement, expanded }) : null;
    const renderPage = () => renderToStaticMarkup(<div className="super-root"
        data-announcement-active={visibleAnnouncement ? "true" : undefined}
        data-monochrome-mode={context.monochrome ? "true" : undefined}
        data-monochrome-scope={context.monochrome?.scope}
        data-monochrome-media={context.monochrome?.desaturateMedia ? "true" : undefined}>
        <SiteNav staticPreview />
        {announcementContent}
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
    return apiPayloadOk({ html, approximate, stylesheets: classicPreviewStylesheets(), context: { snapshotSha: snapshot.sha, routePath, announcement: Boolean(visibleAnnouncement), announcementDraft: Boolean(announcement), monochrome: Boolean(context.monochrome) } });
  }, { requireAllowlist: true, requireAuthSecret: true, rateLimit: { namespace: "site-admin-page-preview", maxRequests: 120 } });
}
