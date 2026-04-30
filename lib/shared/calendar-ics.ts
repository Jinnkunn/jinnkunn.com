// RFC 5545 generator for the public calendar feed. Reads the same
// PublicCalendarData the JSON endpoint serves, emits a `text/calendar`
// document any iCal/Outlook/Google Calendar client can subscribe to
// via `webcal://jinkunchen.com/calendar.ics`.
//
// Why hand-roll instead of pulling in `ical-generator`:
//   - Output is tiny (one VCALENDAR + N VEVENTs); no need for a 30 KB
//     dep that supports timezones, alarms, attendees, etc. we don't use.
//   - Cloudflare Worker bundle stays slim. opennext-cloudflare keeps a
//     hard 1 MB worker-bundle ceiling on free; every dep counts.
//   - Lets us inline the privacy contract (busy events serialize as
//     "Busy" with no description; titleOnly skips description/location/
//     url; full passes through) without trusting a third party to
//     respect it.

import type {
  PublicCalendarData,
  PublicCalendarEvent,
} from "./public-calendar";

const PRODID = "-//jinkunchen.com//Public Calendar//EN";

function formatIcsDateTime(iso: string, isAllDay: boolean): string {
  // RFC 5545 §3.3.4 (DATE) for all-day, §3.3.5 (DATE-TIME) for timed.
  // We always emit UTC ("Z" suffix) because the source ISO already
  // carries an offset; Date.parse normalizes it. Using UTC sidesteps
  // VTIMEZONE entirely — clients render in viewer's local time.
  const date = new Date(iso);
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  if (isAllDay) {
    return `${yyyy}${mm}${dd}`;
  }
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mi = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function escapeIcsText(value: string): string {
  // RFC 5545 §3.3.11 — backslash, comma, semicolon need escaping;
  // newline becomes literal `\n`; CR is dropped. Unicode passes
  // through (clients handle UTF-8).
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  // RFC 5545 §3.1 — content lines must not exceed 75 octets. Continued
  // lines start with a single space. We fold on character count rather
  // than UTF-8 byte count, which is conservative (some clients are
  // strict; over-folding is harmless, under-folding gets parsed as
  // malformed). 70-char chunks leave headroom for multi-byte glyphs.
  if (line.length <= 70) return line;
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 70) {
    const chunk = line.slice(i, i + 70);
    out.push(i === 0 ? chunk : ` ${chunk}`);
  }
  return out.join("\r\n");
}

function formatProperty(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function buildEventBlock(event: PublicCalendarEvent): string {
  const lines: string[] = ["BEGIN:VEVENT"];
  // UID must be globally unique + stable across re-publishes so a
  // subscribed client updates the existing entry instead of stacking
  // duplicates. Use the event id namespaced by the host.
  lines.push(formatProperty("UID", `${event.id}@jinkunchen.com`));
  lines.push(
    formatProperty("DTSTAMP", formatIcsDateTime(new Date().toISOString(), false)),
  );
  if (event.isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateTime(event.startsAt, true)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateTime(event.endsAt, true)}`);
  } else {
    lines.push(formatProperty("DTSTART", formatIcsDateTime(event.startsAt, false)));
    lines.push(formatProperty("DTEND", formatIcsDateTime(event.endsAt, false)));
  }
  lines.push(formatProperty("SUMMARY", escapeIcsText(event.title)));
  // Privacy contract — busy events ship with CLASS:CONFIDENTIAL so
  // syncing clients (especially shared work calendars) can decide to
  // suppress them entirely. titleOnly + full ship CLASS:PUBLIC.
  lines.push(
    formatProperty(
      "CLASS",
      event.visibility === "busy" ? "CONFIDENTIAL" : "PUBLIC",
    ),
  );
  if (event.visibility === "full") {
    if (event.description) {
      lines.push(formatProperty("DESCRIPTION", escapeIcsText(event.description)));
    }
    if (event.location) {
      lines.push(formatProperty("LOCATION", escapeIcsText(event.location)));
    }
    if (event.url) {
      lines.push(formatProperty("URL", event.url));
    }
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export interface BuildIcsOptions {
  /** Name advertised to subscribers (Apple Calendar et al show this
   * in the calendar list). Override per-deployment if we ever build
   * a per-user calendar feed. */
  calendarName?: string;
  /** RFC 7986 §5.7 description; renders below the calendar name in
   * Apple Calendar's source list. */
  calendarDescription?: string;
}

export function buildPublicCalendarIcs(
  data: PublicCalendarData,
  options: BuildIcsOptions = {},
): string {
  const name = options.calendarName ?? "Jinkun Chen — Public Calendar";
  const description =
    options.calendarDescription ??
    "Talks, classes, office hours, and other public events.";
  // CRLF is mandatory per RFC 5545; some clients (Outlook on Windows)
  // refuse to parse LF-only feeds.
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    formatProperty("X-WR-CALNAME", escapeIcsText(name)),
    formatProperty("NAME", escapeIcsText(name)),
    formatProperty("X-WR-CALDESC", escapeIcsText(description)),
    formatProperty("DESCRIPTION", escapeIcsText(description)),
    // Refresh-interval hint for clients (Apple Calendar ships at
    // ≥15 minutes regardless, but advertising 1h is honest about how
    // often the source actually changes — this matches the JSON
    // endpoint's `revalidate = 300` plus realistic operator update
    // cadence).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of data.events) {
    lines.push(buildEventBlock(event));
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
