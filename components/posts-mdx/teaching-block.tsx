import "server-only";

import type { ReactElement } from "react";

import { loadTeachingEntries } from "@/lib/components/source";
import type { TeachingComponentEntry } from "@/lib/components/parse";
import { rankTeachingTerm } from "@/lib/shared/teaching-term";

import { TeachingEntry } from "./teaching-entry";

interface TeachingBlockProps {
  /** Cap rendered teaching entries (top of the list first). Omit for
   * all entries. The page MDX already orders entries newest-first. */
  limit?: number;
}

function TermList({ term, entries, latest = false }: { term: string; entries: TeachingComponentEntry[]; latest?: boolean }) {
  const sharedPeriod = entries.every((entry) => entry.period === entries[0].period) ? entries[0].period : "";
  return (
    <div className="teaching-term">
      <h3>{term || "Other teaching"}</h3>
      {sharedPeriod ? <p className="teaching-term-period">{sharedPeriod}</p> : null}
      <ul className="notion-bulleted-list teaching-list">
        {entries.map((entry, index) => (
          <TeachingEntry key={entry.entryId || `${entry.courseCode}-${index}`} {...entry}
            period={sharedPeriod ? "" : entry.period} showTerm={false} linkCourseName={latest} />
        ))}
      </ul>
    </div>
  );
}

/** Use "Latest" rather than a date-relative "Current" label that could go
 * stale in prerendered HTML. Preserve editor order within each term. */
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

  if (cap) return <ul className="notion-bulleted-list teaching-list">
    {visible.map((entry, index) => <TeachingEntry key={entry.entryId || `${entry.courseCode}-${index}`} {...entry} />)}
  </ul>;

  const groups = new Map<string, TeachingComponentEntry[]>();
  for (const entry of visible) {
    const term = entry.term.trim();
    const group = groups.get(term);
    if (group) group.push(entry);
    else groups.set(term, [entry]);
  }
  const [[term, latest], ...archive] = [...groups].sort(([a], [b]) => rankTeachingTerm(b) - rankTeachingTerm(a));
  return (
    <div className="teaching-terms">
      <section id="latest-term" aria-label="Latest term">
        <h2>Latest term</h2>
        <TermList term={term} entries={latest} latest />
      </section>
      {archive.length ? <section aria-label="Past terms">
        <h2>Past terms</h2>
        {archive.map(([label, courses]) => <TermList key={label} term={label} entries={courses} />)}
      </section> : null}
    </div>
  );
}
