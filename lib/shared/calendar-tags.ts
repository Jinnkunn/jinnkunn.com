// Extract `#hashtag` markers from a public-calendar event so the
// public /calendar page can offer tag-based filtering ("show me only
// #talks" / "only #office-hours"). The operator writes the tags
// inline in the event title or description on their personal calendar
// — no separate metadata field, just markdown-style hashtags
// borrowed from the same convention the workspace's mdx-blocks parser
// uses for hashtag-flavored todo metadata.
//
// Lookup is case-insensitive on storage but each tag is rendered as
// the first form we saw it in (so `#Talks` and `#talks` collapse into
// a single chip rather than two flavours of the same idea). Words
// must start with an ASCII letter; pure-numeric tags (`#2026`) are
// excluded — they pollute the chip UI without adding signal.

import type { PublicCalendarEvent } from "./public-calendar";

const TAG_PATTERN = /(?:^|[\s(.,;:!?[{<>"'-])(#[a-zA-Z][\w-]{0,31})\b/g;

function harvestFromString(input: string | null | undefined, into: Set<string>): void {
  if (!input) return;
  TAG_PATTERN.lastIndex = 0;
  for (const match of input.matchAll(TAG_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    // Drop the leading `#`; lowercase for the bucket key. The original
    // spelling is preserved separately by the dedupe step below.
    const lower = raw.slice(1).toLowerCase();
    if (lower.length === 0) continue;
    // Numeric-only tags (#2026) — skipped for noise reasons explained
    // in the module header.
    if (/^\d+$/.test(lower)) continue;
    into.add(lower);
  }
}

/** Tags reachable from a single event. Busy events never include
 * details (their title is hardcoded "Busy"), so this returns an empty
 * array for those — the resolved visibility check happens upstream
 * via the event's `visibility` field. */
export function extractEventTags(event: PublicCalendarEvent): string[] {
  const bucket = new Set<string>();
  if (event.visibility !== "busy") {
    harvestFromString(event.title, bucket);
  }
  if (event.visibility === "full") {
    harvestFromString(event.description, bucket);
    harvestFromString(event.location, bucket);
  }
  return Array.from(bucket);
}

/** Aggregate every distinct tag across the data set, sorted by count
 * descending then alphabetically. Counts let the UI render frequency-
 * sorted chips so the operator's most-used tags surface first. */
export function summarizeTags(
  events: readonly PublicCalendarEvent[],
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const tags = extractEventTags(event);
    // Multi-occurrence in one event still bumps once; counting a tag
    // twice for "talk #conf #conf" exaggerates frequency.
    const seen = new Set<string>();
    for (const tag of tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Filter predicate: returns true when the event matches AT LEAST
 * one of the selected tags (OR logic). An empty selection passes
 * everything through unchanged. */
export function eventMatchesAnyTag(
  event: PublicCalendarEvent,
  selectedTags: ReadonlySet<string>,
): boolean {
  if (selectedTags.size === 0) return true;
  const tags = extractEventTags(event);
  for (const tag of tags) {
    if (selectedTags.has(tag)) return true;
  }
  return false;
}
