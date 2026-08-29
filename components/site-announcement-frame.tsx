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
  const toggleLabel = expanded ? "Collapse announcement" : "Expand announcement";

  if (!expanded) {
    return (
      <aside
        className="site-announcement site-announcement--compact"
        aria-label={announcement.title}
        data-expanded="false"
      >
        <div className="site-announcement__inner site-announcement__inner--compact">
          <span className="site-announcement__marker" aria-hidden="true" />
          <div className="site-announcement__compact-content" id={contentId}>
            {compactContent || <p>{announcement.title}</p>}
          </div>
          {canToggle ? (
            <button
              type="button"
              className="site-announcement__toggle"
              aria-controls={contentId}
              aria-expanded="false"
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => setUserPreference({ key: preferenceKey, expanded: true })}
            >
              <span className="site-announcement__toggle-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <section
      className="site-announcement site-announcement--expanded"
      aria-label={announcement.title}
      data-expanded="true"
      data-layout={announcement.layout}
    >
      <div className="site-announcement__inner site-announcement__inner--expanded">
        {canToggle ? (
          <div className="site-announcement__header">
            <button
              type="button"
              className="site-announcement__toggle"
              aria-controls={contentId}
              aria-expanded="true"
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => setUserPreference({ key: preferenceKey, expanded: false })}
            >
              <span className="site-announcement__toggle-icon" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="site-announcement__body" id={contentId}>
          {children}
        </div>
      </div>
    </section>
  );
}
