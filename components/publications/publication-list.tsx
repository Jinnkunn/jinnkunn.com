import type {
  PublicationAuthor,
} from "@/lib/seo/publications-items";
import { publicationAnchorId, type IdentifiedPublication } from "@/lib/shared/publication-identity";

import { additionalPublicationVenues, classifyLabel, venueSummaryText, type LabelKind } from "./labels";
import { PublicationHighlightBadge } from "./publication-highlight-badge";
import { PublicationResourceLinks } from "./publication-resource-links";

function orderYearKey(year: string): number {
  const m = /\d{4}/.exec(year);
  return m ? Number(m[0]) : -1;
}

function groupsByYear(entries: IdentifiedPublication[]) {
  const map = new Map<string, IdentifiedPublication[]>();
  for (const entry of entries) {
    const year = entry.year || "Unknown";
    const arr = map.get(year) ?? [];
    arr.push(entry);
    map.set(year, arr);
  }
  return Array.from(map.entries()).sort(
    (a, b) => orderYearKey(b[0]) - orderYearKey(a[0]),
  );
}

function tagTone(kind: LabelKind): {
  color: string;
  background: string;
} {
  if (kind === "conference") return { color: "color-red", background: "bg-red" };
  if (kind === "journal") return { color: "color-orange", background: "bg-orange" };
  if (kind === "arxiv") return { color: "color-purple", background: "bg-purple" };
  if (kind === "workshop") return { color: "color-blue", background: "bg-blue" };
  return { color: "color-gray", background: "bg-gray" };
}

function PublicationTag({ label }: { label: string }) {
  const tone = tagTone(classifyLabel(label));
  return (
    <em>
      <span className={`highlighted-color ${tone.color}`}>
        <span className={`highlighted-background ${tone.background}`}>
          <code className="code">
            <strong>{label}</strong>
          </code>
        </span>
      </span>
    </em>
  );
}

function AuthorsLine({ authors }: { authors: PublicationAuthor[] }) {
  if (authors.length === 0) return null;
  return (
    <>
      {authors.map((author, index) => (
        <span
          key={`${author.name}-${index}`}
          className={
            author.isSelf
              ? "highlighted-color color-default"
              : "highlighted-color color-gray"
          }
        >
          {author.isSelf ? (
            <span className="highlighted-background bg-default">
              <strong>
                <u>{author.name}</u>
              </strong>
            </span>
          ) : (
            author.name
          )}
          {index < authors.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}

export function PublicationRow({ entry }: { entry: IdentifiedPublication }) {
  const authors =
    entry.authorsRich ?? (entry.authors ?? []).map((name) => ({ name, isSelf: false }));
  const venues = entry.venues ?? [];
  const additionalVenues = additionalPublicationVenues(venues);
  const labels = entry.labels ?? [];
  const highlights = entry.highlights ?? [];
  const primaryVenue = venues.length > 0 ? venueSummaryText(venues[0]) : "";
  const hasMetadata = labels.length > 0 || highlights.length > 0;
  const title = entry.title || "Untitled publication";
  const anchor = publicationAnchorId(entry.entryId);
  const authorsId = `${anchor}-authors`;
  const hasAuthors = authors.length > 0;

  return (
    <div id={anchor} tabIndex={-1} className={hasAuthors ? "notion-toggle closed publication-toggle" : "publication-toggle publication-toggle--static"}>
      <div className="notion-toggle__summary">
        {hasAuthors ? (
          <button type="button" className="notion-toggle__trigger" aria-expanded="false"
            aria-controls={authorsId} aria-label={`Authors of ${title}`}>
            <span className="notion-toggle__trigger_icon" aria-hidden="true"><span>‣</span></span>
          </button>
        ) : <span className="notion-toggle__trigger" aria-hidden="true" />}
        <span className="notion-semantic-string">
          <span className="pub-title-line">
            <strong className="pub-title-text">{title}</strong>{" "}
            <a className="pub-permalink" href={`#${anchor}`} aria-label={`Link to ${title}`} title="Link to this publication">#</a>
          </span>
          {hasMetadata && (
            <>
              <br />
              <span className="pub-meta-line ds-meta-row">
                {labels.map((label) => (
                  <span key={label} className="pub-tag-prefix">
                    <PublicationTag label={label} />{" "}
                  </span>
                ))}
                {highlights.length > 0 && (
                  <span className="pub-highlight-list ds-meta-list">
                    {highlights.map((highlight) => (
                      <PublicationHighlightBadge key={highlight} highlight={highlight} />
                    ))}
                  </span>
                )}
              </span>
            </>
          )}
          {primaryVenue ? (
            <span className="pub-venue-line highlighted-color color-gray">{primaryVenue}</span>
          ) : null}
          {additionalVenues.map((venue, index) => (
            <span key={`${venue.type}-${index}`} className="pub-venue-line highlighted-color color-gray">
              {venue.text}
            </span>
          ))}
          <PublicationResourceLinks entry={entry} />
        </span>
      </div>
      {hasAuthors && (
        <div className="notion-toggle__content" id={authorsId} hidden aria-hidden="true">
          <blockquote className="notion-quote">
            <span className="notion-semantic-string">
              <AuthorsLine authors={authors} />
            </span>
          </blockquote>
        </div>
      )}
    </div>
  );
}

export function PublicationList({ entries }: { entries: IdentifiedPublication[] }) {
  const groups = groupsByYear(entries);

  return (
    <>
      {groups.map(([year, items]) => (
        <section key={year} className="publication-year">
          <span className="notion-heading__anchor" />
          <h2 className="notion-heading notion-semantic-string">{year}</h2>
          {items.map((entry) => (
            <PublicationRow key={entry.entryId} entry={entry} />
          ))}
        </section>
      ))}
    </>
  );
}
