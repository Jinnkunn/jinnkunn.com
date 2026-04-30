import type { Metadata } from "next";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { PublicCalendarClient } from "@/components/calendar/public-calendar-client";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getPublicCalendarData } from "@/lib/server/public-calendar-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

export function generateMetadata(): Metadata {
  const cfg = getSiteConfig();
  const base = buildPageMetadata({
    cfg,
    title: "Calendar",
    description: "Public calendar events.",
    pathname: "/calendar",
    type: "website",
  });
  // Advertise the ICS feed via `<link rel="alternate" type="text/calendar">`
  // so feed-aware tools (Apple News reader-style apps, RSS clients with
  // calendar discovery, browser extensions) auto-detect the
  // subscription source from this page. The Subscribe button in the
  // toolbar is the human-discoverable path; this is the
  // machine-discoverable one.
  return {
    ...base,
    alternates: {
      ...(base.alternates ?? {}),
      types: {
        ...((base.alternates?.types as Record<string, unknown>) ?? {}),
        "text/calendar": "/api/public/calendar/calendar.ics",
      },
    },
  };
}

export default function CalendarPage() {
  const data = getPublicCalendarData();
  return (
    <ClassicPageShell
      title="Calendar"
      className="super-content page__calendar parent-page__calendar"
    >
      <PublicCalendarClient initialData={data} />
    </ClassicPageShell>
  );
}
