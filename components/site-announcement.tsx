import "server-only";

import { SiteAnnouncementFrame, type AnnouncementFrameData } from "@/components/site-announcement-frame";
import { renderSimpleMarkdown } from "@/lib/posts/simple-markdown";
import {
  splitAnnouncementColumns,
  type SiteAnnouncement as SiteAnnouncementData,
} from "@/lib/shared/announcements";

async function renderMdx(source: string) {
  if (!source.trim()) return null;
  return renderSimpleMarkdown(source);
}

export function announcementFrameData({ id, title, scope, routes, layout, initialState, collapsible }: SiteAnnouncementData): AnnouncementFrameData {
  return { id, title, scope, routes, layout, initialState, collapsible };
}

export async function renderAnnouncementPanels(announcement: SiteAnnouncementData) {
  const bodyParts =
    announcement.layout === "columns"
      ? splitAnnouncementColumns(announcement.bodyMdx)
      : [announcement.bodyMdx];
  const [compactContent, ...bodyContent] = await Promise.all([
    renderMdx(announcement.compactMdx),
    ...bodyParts.map(renderMdx),
  ]);

  return {
    compact: (
        <div className="site-announcement__mdx site-announcement__mdx--compact">
          {compactContent || <p>{announcement.title}</p>}
        </div>
    ),
    expanded: (
      <div
        className="site-announcement__layout"
        data-columns={bodyContent.length > 1 ? "true" : "false"}
      >
        {bodyContent.map((content, index) => (
          <div className="site-announcement__mdx" key={index}>
            {content}
          </div>
        ))}
      </div>
    ),
  };
}

export async function SiteAnnouncement({ announcement }: { announcement: SiteAnnouncementData }) {
  const { compact, expanded } = await renderAnnouncementPanels(announcement);
  return <SiteAnnouncementFrame announcement={announcementFrameData(announcement)} compactContent={compact}>{expanded}</SiteAnnouncementFrame>;
}
