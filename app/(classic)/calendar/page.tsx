import type { Metadata } from "next";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { PublicCalendarView } from "@/components/calendar/public-calendar-view";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getPublicCalendarData } from "@/lib/server/public-calendar-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

export function generateMetadata(): Metadata {
  const cfg = getSiteConfig();
  return buildPageMetadata({
    cfg,
    title: "Calendar",
    description: "Public calendar events.",
    pathname: "/calendar",
    type: "website",
  });
}

export default function CalendarPage() {
  const data = getPublicCalendarData();
  return (
    <ClassicPageShell
      title="Calendar"
      className="super-content page__calendar parent-page__calendar"
    >
      <PublicCalendarView data={data} />
    </ClassicPageShell>
  );
}
