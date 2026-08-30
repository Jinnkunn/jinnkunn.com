import "server-only";

import { SiteAnnouncementFrame } from "@/components/site-announcement-frame";
import { renderSimpleMarkdown } from "@/lib/posts/simple-markdown";
import {
  splitAnnouncementColumns,
  type SiteAnnouncement as SiteAnnouncementData,
} from "@/lib/shared/announcements";

async function renderMdx(source: string) {
  if (!source.trim()) return null;
  return renderSimpleMarkdown(source);
}

export async function SiteAnnouncement({
  announcement,
}: {
  announcement: SiteAnnouncementData;
}) {
  const bodyParts =
    announcement.layout === "columns"
      ? splitAnnouncementColumns(announcement.bodyMdx)
      : [announcement.bodyMdx];
  const [compactContent, ...bodyContent] = await Promise.all([
    renderMdx(announcement.compactMdx),
    ...bodyParts.map(renderMdx),
  ]);

  return (
    <SiteAnnouncementFrame
      announcement={announcement}
      compactContent={
        <div className="site-announcement__mdx site-announcement__mdx--compact">
          {compactContent}
        </div>
      }
    >
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
    </SiteAnnouncementFrame>
  );
}
