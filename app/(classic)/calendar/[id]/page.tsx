import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getPublicCalendarEventById } from "@/lib/server/public-calendar-data";
import { getSiteConfig } from "@/lib/site-config";
import type { PublicCalendarEvent } from "@/lib/shared/public-calendar";

// Per-event detail page. Reachable via:
//
//   /calendar/{event-id}
//
// where `event-id` matches PublicCalendarEvent.id (the EventKit
// externalIdentifier the workspace projection emits). Built so that:
//
//   - Search engines can index titled events ("jinkun chen [talk
//     title]" → this page).
//   - A shareable link from social / email lands on a clean page
//     instead of forcing the visitor to scrub the agenda.
//   - The `WithArchive` data fetch skips the time-decay filter so an
//     event link still resolves a year later, even though the
//     /calendar agenda has long since dropped it.
//
// Privacy contract: only `visibility: "full"` events render content
// here. `titleOnly` events show the title + time only; `busy` events
// 404. The detail surface intentionally NEVER fabricates fields the
// projection withheld; if it's not in the payload, it's not on screen.

const REVALIDATE_SECONDS = 300;
export const revalidate = REVALIDATE_SECONDS;
// Each event id is a stable opaque string from EventKit; we don't
// know the full set at build time without iterating D1. Force-dynamic
// per-event makes the route lazy — the first visitor to a given id
// pays one read; subsequent visitors hit the page cache for 5 min.
export const dynamic = "force-dynamic";

type Params = { id: string };

async function findEvent(id: string): Promise<PublicCalendarEvent | null> {
  // Single indexed D1 read instead of loading the full archive — the
  // archive scan still serves as a graceful fallback when D1 isn't
  // bound. Both paths preserve the time-decay-archive escape hatch
  // so a deep link to a year-old event still resolves.
  return getPublicCalendarEventById(id);
}

function formatRange(event: PublicCalendarEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (event.isAllDay) {
    const sameDay =
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === end.getUTCMonth() &&
      start.getUTCDate() === end.getUTCDate();
    const fmt = new Intl.DateTimeFormat("en", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return sameDay ? `${fmt.format(start)} (all day)` : `${fmt.format(start)} – ${fmt.format(end)}`;
  }
  const dateFmt = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await findEvent(id);
  const cfg = getSiteConfig();
  if (!event || event.visibility === "busy") {
    return buildPageMetadata({
      cfg,
      title: "Calendar event",
      description: "Public calendar event.",
      pathname: `/calendar/${id}`,
      type: "article",
    });
  }
  const description =
    event.visibility === "full" && event.description
      ? event.description.slice(0, 240)
      : `Public calendar event on ${formatRange(event)}.`;
  return buildPageMetadata({
    cfg,
    title: event.title,
    description,
    pathname: `/calendar/${event.id}`,
    type: "article",
    publishedTime: event.startsAt,
  });
}

export default async function CalendarEventPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const event = await findEvent(id);
  // 404 for unknown ids and for busy events — busy entries are
  // intentionally opaque; surfacing a detail page would defeat that.
  if (!event || event.visibility === "busy") notFound();

  return (
    <ClassicPageShell
      title={event.title}
      className="super-content page__calendar-event"
    >
      <article className="public-calendar-event">
        <header className="public-calendar-event__header">
          <p className="public-calendar-event__breadcrumb">
            <Link href="/calendar">← Back to calendar</Link>
          </p>
          <h1 className="public-calendar-event__title">{event.title}</h1>
          <p className="public-calendar-event__range">{formatRange(event)}</p>
          {event.calendarTitle ? (
            <p className="public-calendar-event__calendar">
              {event.calendarTitle}
            </p>
          ) : null}
        </header>
        {event.visibility === "full" ? (
          <div className="public-calendar-event__body">
            {event.location ? (
              <p>
                <strong>Location:</strong> {event.location}
              </p>
            ) : null}
            {event.url ? (
              <p>
                <strong>Link:</strong>{" "}
                <a href={event.url} rel="noreferrer">
                  {event.url}
                </a>
              </p>
            ) : null}
            {event.description ? (
              <div className="public-calendar-event__description">
                {event.description.split(/\r?\n+/).map((paragraph, idx) => (
                  <p key={idx}>{paragraph}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="public-calendar-event__hint">
            Time-only listing. The host shares more details closer to the date.
          </p>
        )}
      </article>
    </ClassicPageShell>
  );
}
