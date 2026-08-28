import "server-only";

import type { ReactElement, ReactNode } from "react";

import { ClassicLink } from "@/components/classic/classic-link";
import {
  loadTeachingEntries,
  loadWorksEntries,
} from "@/lib/components/source";

interface BioExperienceBlockProps {
  teachingLimit?: number;
  worksLimit?: number;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value > 0 ? Math.trunc(value) : fallback;
}

function OptionalLink({ href, children }: { href?: string; children: ReactNode }) {
  return href ? <ClassicLink href={href}>{children}</ClassicLink> : children;
}

export async function BioExperienceBlock({
  teachingLimit,
  worksLimit,
}: BioExperienceBlockProps): Promise<ReactElement> {
  const [teachingEntries, worksEntries] = await Promise.all([
    loadTeachingEntries(),
    loadWorksEntries(),
  ]);
  const visibleTeaching = teachingEntries.slice(0, positiveLimit(teachingLimit, 3));
  const visibleWorks = [
    ...worksEntries.filter((entry) => entry.category === "recent"),
    ...worksEntries.filter((entry) => entry.category === "passed"),
  ].slice(0, positiveLimit(worksLimit, 3));

  return (
    <section className="bio-experience" aria-label="Selected teaching and experience">
      <div className="bio-experience__group">
        <header className="bio-experience__header">
          <h3>Teaching</h3>
          <ClassicLink href="/teaching" className="bio-experience__all-link">
            View all
          </ClassicLink>
        </header>
        <ol className="bio-experience__list">
          {visibleTeaching.map((entry, index) => {
            const title =
              [entry.courseCode, entry.courseName].filter(Boolean).join(" · ") ||
              "Untitled course";
            const details = [entry.role, entry.term].filter(Boolean).join(" · ");
            return (
              <li key={entry.entryId || `${title}-${index}`}>
                <div className="bio-experience__entry-copy">
                  <p className="bio-experience__entry-title">
                    <OptionalLink href={entry.courseUrl}>{title}</OptionalLink>
                  </p>
                  {details ? <p className="bio-experience__entry-meta">{details}</p> : null}
                </div>
                {entry.period ? (
                  <p className="bio-experience__entry-period">{entry.period}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="bio-experience__group">
        <header className="bio-experience__header">
          <h3>Experience</h3>
          <ClassicLink href="/works" className="bio-experience__all-link">
            View all
          </ClassicLink>
        </header>
        <ol className="bio-experience__list">
          {visibleWorks.map((entry, index) => {
            const details = [entry.affiliation, entry.location].filter(Boolean).join(", ");
            return (
              <li key={entry.entryId || `${entry.role}-${index}`}>
                <div className="bio-experience__entry-copy">
                  <p className="bio-experience__entry-title">{entry.role || "Untitled role"}</p>
                  {details ? (
                    <p className="bio-experience__entry-meta">
                      <OptionalLink href={entry.affiliationUrl}>{details}</OptionalLink>
                    </p>
                  ) : null}
                </div>
                {entry.period ? (
                  <p className="bio-experience__entry-period">{entry.period}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
