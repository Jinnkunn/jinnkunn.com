"use client";

import { useId, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { SiteAnnouncement } from "@/lib/shared/announcements";

function routeMatches(pathname: string, routes: string[]): boolean {
  return routes.some((route) => {
    const normalized = route === "/" ? "/" : route.replace(/\/+$/, "");
    return normalized === "/"
      ? pathname === "/"
      : pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}

function visibleOnRoute(announcement: SiteAnnouncement, pathname: string): boolean {
  if (announcement.scope === "home") return pathname === "/";
  if (announcement.scope === "paths") return routeMatches(pathname, announcement.routes);
  return true;
}

function initialExpanded(announcement: SiteAnnouncement, isHome: boolean): boolean {
  if (announcement.initialState === "expanded") return true;
  if (announcement.initialState === "compact") return false;
  return isHome;
}

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
      : initialExpanded(announcement, isHome);

  if (!visibleOnRoute(announcement, pathname)) return null;

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
