"use client";

import { useId, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { announcementInitiallyExpanded, announcementVisibleOnRoute, type SiteAnnouncement } from "@/lib/shared/announcements";

export function SiteAnnouncementFrame({
  announcement,
  compactContent,
  children,
}: {
  announcement: SiteAnnouncement;
  compactContent: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const contentId = useId();
  const compactContentId = `${contentId}-compact`;
  const expandedContentId = `${contentId}-expanded`;
  const isHome = pathname === "/";
  const preferenceKey = `${announcement.id}:${pathname}`;
  const [userPreference, setUserPreference] = useState<{
    key: string;
    expanded: boolean;
  } | null>(null);
  const expanded =
    userPreference?.key === preferenceKey
      ? userPreference.expanded
      : announcementInitiallyExpanded(announcement, isHome);

  if (!announcementVisibleOnRoute(announcement, pathname)) return null;

  const canToggle = announcement.collapsible;

  return (
    <aside
      className={`site-announcement site-announcement--${expanded ? "expanded" : "compact"}`}
      aria-label={announcement.title}
      data-expanded={expanded ? "true" : "false"}
      data-layout={announcement.layout}
    >
      <div
        className="site-announcement__panel-shell site-announcement__panel-shell--compact"
        aria-hidden={expanded}
        inert={expanded ? true : undefined}
      >
        <div className="site-announcement__panel">
          <div className="site-announcement__inner site-announcement__inner--compact">
            <span className="site-announcement__marker" aria-hidden="true" />
            <div
              className="site-announcement__compact-content"
              id={compactContentId}
            >
              {compactContent || <p>{announcement.title}</p>}
            </div>
            {canToggle ? (
              <button
                type="button"
                className="site-announcement__toggle"
                aria-controls={expandedContentId}
                aria-expanded="false"
                aria-label="Expand announcement"
                title="Expand announcement"
                onClick={() =>
                  setUserPreference({ key: preferenceKey, expanded: true })
                }
              >
                <span className="site-announcement__toggle-icon" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="site-announcement__panel-shell site-announcement__panel-shell--expanded"
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="site-announcement__panel">
          <div className="site-announcement__inner site-announcement__inner--expanded">
            {canToggle ? (
              <div className="site-announcement__header">
                <button
                  type="button"
                  className="site-announcement__toggle"
                  aria-controls={expandedContentId}
                  aria-expanded="true"
                  aria-label="Collapse announcement"
                  title="Collapse announcement"
                  onClick={() =>
                    setUserPreference({ key: preferenceKey, expanded: false })
                  }
                >
                  <span className="site-announcement__toggle-icon" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <div className="site-announcement__body" id={expandedContentId}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
