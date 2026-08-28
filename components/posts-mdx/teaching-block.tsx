import "server-only";

import type { ReactElement } from "react";

import { loadTeachingEntries } from "@/lib/components/source";

import { TeachingEntry } from "./teaching-entry";

interface TeachingBlockProps {
  /** Cap rendered teaching entries (top of the list first). Omit for
   * all entries. The page MDX already orders entries newest-first. */
  limit?: number;
}

/** Embeddable view over content/components/teaching.mdx — the
 * dedicated component file edited via the admin Components → Teaching
 * panel. The /teaching public route renders intro / header-links /
 * footer-links from `content/pages/teaching.mdx` and embeds this
 * block to render the entries list. Mirrors the
 * `<ul className="notion-bulleted-list teaching-list">` markup the
 * legacy inline-entries layout used so the embed visually matches
 * the original. */
export async function TeachingBlock({
  limit,
}: TeachingBlockProps): Promise<ReactElement> {
  const entries = await loadTeachingEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visible = cap ? entries.slice(0, cap) : entries;

  if (visible.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No teaching activities yet.
      </p>
    );
  }

  return (
    <ul className="notion-bulleted-list teaching-list">
      {visible.map((entry, index) => (
        <TeachingEntry
          key={`${entry.term}-${entry.courseCode}-${index}`}
          term={entry.term}
          period={entry.period}
          role={entry.role}
          courseCode={entry.courseCode}
          courseName={entry.courseName}
          courseUrl={entry.courseUrl}
          instructor={entry.instructor}
        />
      ))}
    </ul>
  );
}
