import type { Metadata } from "next";

import calendarData from "@/content/calendar-public.json";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { PublicCalendarView } from "@/components/calendar/public-calendar-view";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import { normalizePublicCalendarData } from "@/lib/shared/public-calendar";

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
  const data = normalizePublicCalendarData(calendarData);
  return (
    <ClassicPageShell
      title="Calendar"
      className="super-content page__calendar parent-page__calendar"
    >
      <PublicCalendarView data={data} />
    </ClassicPageShell>
  );
}
