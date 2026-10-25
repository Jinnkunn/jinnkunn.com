import type { NextRequest } from "next/server";
import type { ReactNode } from "react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { HomeArticle, PageArticle, PostArticle } from "@/components/posts-mdx/document-layouts";
import { renderAnnouncementPreview } from "@/components/site-admin/announcement-preview";
import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import { withPreviewSources } from "@/lib/posts/preview-context";
import { classicPreviewStylesheets } from "@/lib/server/classic-preview-styles";
import { isMdxRuntimeCodeGenerationError, renderMdxPreviewHtml } from "@/lib/site-admin/mdx-preview-render";
import { apiError, apiPayloadOk, readSiteAdminJsonCommand, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { loadPublishedSnapshot } from "@/lib/server/publication-review-service";
import { pagePreviewContext, resolvePreviewEmbeds, type PagePreviewOptions } from "@/lib/site-admin/page-preview-context";
import { resolvePagePreviewDocument } from "@/lib/site-admin/page-preview-document";
import { announcementInitiallyExpanded, normalizeAnnouncement } from "@/lib/shared/announcements";
import { isSiteComponentName } from "@/lib/site-admin/component-registry";
import { isValidSlug } from "@/lib/posts/slug";
import { isValidPageSlug } from "@/lib/pages/slug";

export const runtime = "nodejs";
function unsupported(error: unknown) {
  return isMdxRuntimeCodeGenerationError(error) || error instanceof Error && /Preview supports|Unsupported preview|not supported in previews|not executed in previews|but it's on the client|client module|Expected component|Cannot access .* on the server/.test(error.message);
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(req, async () => {
    const parsed = await readSiteAdminJsonCommand(req, (raw) => {
      if (typeof raw.source !== "string" || raw.source.length > 200_000) return { ok: false, error: "Invalid preview source", status: 400 };
      let document: PagePreviewOptions["document"];
      if (raw.document !== undefined) {
        const candidate = raw.document as Record<string, unknown> | null;
        if (!candidate || !["posts", "pages"].includes(String(candidate.kind)) || typeof candidate.slug !== "string" ||
          !(candidate.kind === "posts" ? isValidSlug(candidate.slug) : isValidPageSlug(candidate.slug)) ||
          typeof candidate.source !== "string" || candidate.source.length > 200_000) return { ok: false, error: "Invalid preview document", status: 400 };
        document = { kind: candidate.kind as "posts" | "pages", slug: candidate.slug, source: candidate.source };
      }
      if (raw.component !== undefined && !isSiteComponentName(raw.component)) return { ok: false, error: "Invalid preview collection", status: 400 };
      const routePath = typeof raw.routePath === "string" && /^\/(?!\/)[a-z0-9/-]*$/i.test(raw.routePath) ? raw.routePath : raw.home === true ? "/" : document ? `/${document.kind === "posts" ? "blog" : "pages"}/${document.slug}` : "/preview";
      const announcement = raw.announcement ? normalizeAnnouncement(raw.announcement) : null;
      if (raw.announcement && !announcement) return { ok: false, error: "Invalid preview announcement", status: 400 };
      if (announcement && announcement.bodyMdx.length + announcement.compactMdx.length > 104_000) return { ok: false, error: "Announcement is too large", status: 400 };
      return { ok: true, value: { source: raw.source, title: typeof raw.title === "string" ? raw.title.slice(0, 500) : "Preview", home: raw.home === true, routePath, document, component: isSiteComponentName(raw.component) ? raw.component : undefined, announcement, includeAnnouncement: raw.includeAnnouncement !== false, display: raw.display === "expanded" || raw.display === "compact" ? raw.display : "route" } };
    });
    if (!parsed.ok) return parsed.res;
    const input = parsed.value;
    const snapshot = await loadPublishedSnapshot();
    const context = pagePreviewContext(snapshot.sources, input.routePath, input.announcement || undefined);
    let model: ReturnType<typeof resolvePagePreviewDocument>;
    try { model = resolvePagePreviewDocument({ ...input, announcement: input.announcement || undefined }, snapshot.sources); }
    catch { return apiError("Preview metadata could not be read. Repair the frontmatter first.", { status: 400, code: "PREVIEW_METADATA_INVALID" }); }
    return withPreviewSources(model.sources, async () => {
      let body: ReactNode;
      let headings: Awaited<ReturnType<typeof compilePostMdx>>["headings"] = [];
      let approximate = false;
      const fallback = () => <div dangerouslySetInnerHTML={{ __html: renderMdxPreviewHtml(resolvePreviewEmbeds(model.source, model.sources)) }} />;
      try {
        const compiled = await compilePostMdx(model.source);
        headings = compiled.headings;
        body = <compiled.Content components={postMdxComponents} />;
      } catch (error) {
        if (!unsupported(error)) throw error;
        approximate = true;
        body = fallback();
      }
      const visibleAnnouncement = input.includeAnnouncement ? context.announcement : null;
      const expanded = visibleAnnouncement ? input.display === "expanded" || (input.display === "route" && announcementInitiallyExpanded(visibleAnnouncement, input.routePath === "/")) : false;
      const notice = visibleAnnouncement ? await renderAnnouncementPreview({ announcement: visibleAnnouncement, expanded }) : null;
      const { renderToReadableStream } = await import("react-dom/server");
      async function renderPage() {
        let renderingError: unknown;
        const page = model.kind === "home" ? <HomeArticle title={model.title}>{body}</HomeArticle> : model.kind === "posts"
          ? <PostArticle entry={model.entry} headings={headings} prev={model.adjacent.prev} next={model.adjacent.next}>{body}</PostArticle>
          : <PageArticle entry={model.entry} trail={model.trail}>{body}</PageArticle>;
        const stream = await renderToReadableStream(<div className="super-root"
          data-announcement-active={visibleAnnouncement ? "true" : undefined}
          data-monochrome-mode={context.monochrome ? "true" : undefined}
          data-monochrome-scope={context.monochrome?.scope}
          data-monochrome-media={context.monochrome?.desaturateMedia ? "true" : undefined}>
          <SiteNav staticPreview />{notice}<div id="content-wrapper" className="super-content-wrapper">{page}</div><SiteFooter staticPreview />
        </div>, { signal: req.signal, onError(error) { renderingError = error; return "PREVIEW_RENDERING"; } });
        await stream.allReady;
        const html = await new Response(stream).text();
        if (renderingError) throw renderingError;
        return html;
      }
      let html;
      try { html = await renderPage(); }
      catch (error) {
        if (req.signal.aborted || !unsupported(error)) throw error;
        approximate = true; body = fallback(); headings = [];
        html = await renderPage();
      }
      return apiPayloadOk({ html, approximate, stylesheets: classicPreviewStylesheets(), context: { snapshotSha: snapshot.sha, routePath: input.routePath, renderer: model.kind, announcement: Boolean(visibleAnnouncement), announcementDraft: Boolean(input.announcement), monochrome: Boolean(context.monochrome) } });
    });
  }, { requireAllowlist: true, requireAuthSecret: true, rateLimit: { namespace: "site-admin-page-preview", maxRequests: 120 } });
}
