import { renderSimpleMarkdown } from "@/lib/posts/simple-markdown";
import { splitAnnouncementColumns, type SiteAnnouncement } from "@/lib/shared/announcements";

export async function renderAnnouncementPreview({ announcement, expanded }: { announcement: SiteAnnouncement; expanded: boolean }) {
  const parts = announcement.layout === "columns" ? splitAnnouncementColumns(announcement.bodyMdx) : [announcement.bodyMdx];
  const [compact, ...body] = await Promise.all([renderSimpleMarkdown(announcement.compactMdx || announcement.title), ...parts.map(renderSimpleMarkdown)]);
  return <aside className={`site-announcement site-announcement--${expanded ? "expanded" : "compact"}`} aria-label={announcement.title} data-expanded={String(expanded)} data-layout={announcement.layout}>
    <div className={`site-announcement__panel-shell site-announcement__panel-shell--${expanded ? "expanded" : "compact"}`}>
      <div className="site-announcement__panel"><div className={`site-announcement__inner site-announcement__inner--${expanded ? "expanded" : "compact"}`}>
        {expanded ? <div className="site-announcement__body"><div className="site-announcement__layout" data-columns={parts.length > 1 ? "true" : "false"}>
          {body.map((content, index) => <div key={index} className="site-announcement__mdx">{content}</div>)}
        </div></div> : <><span className="site-announcement__marker" aria-hidden="true" /><div className="site-announcement__compact-content"><div className="site-announcement__mdx site-announcement__mdx--compact">{compact}</div></div></>}
      </div></div>
    </div>
  </aside>;
}
