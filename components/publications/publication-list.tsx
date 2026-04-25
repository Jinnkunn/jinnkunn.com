import type {
  PublicationAuthor,
  PublicationStructuredEntry,
  PublicationVenue,
} from "@/lib/seo/publications-items";

import { classifyLabel, type LabelKind } from "./publication-card";

function orderYearKey(year: string): number {
  const m = /\d{4}/.exec(year);
  return m ? Number(m[0]) : -1;
}

function groupsByYear(entries: PublicationStructuredEntry[]) {
  const map = new Map<string, PublicationStructuredEntry[]>();
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

function venueLabel(venue: PublicationVenue): string {
  return venue.type || "source";
}

function VenueLine({ venue }: { venue: PublicationVenue }) {
  return (
    <>
      <PublicationTag label={venueLabel(venue)} />
      <span className="pub-tag-colon">
        <strong>: </strong>
      </span>
      <span className="highlighted-color color-gray">
        {venue.url ? (
          <a
            className="notion-link link"
            href={venue.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {venue.text}
          </a>
        ) : (
          venue.text
        )}
      </span>
    </>
  );
}

function fallbackVenues(entry: PublicationStructuredEntry): PublicationVenue[] {
  const venues = entry.venues ?? [];
  const usedUrls = new Set(venues.map((v) => v.url).filter(Boolean) as string[]);
  const out = [...venues];
  if (entry.doiUrl && !usedUrls.has(entry.doiUrl)) {
    out.push({ type: "DOI", text: entry.doiUrl, url: entry.doiUrl });
  }
  if (entry.arxivUrl && !usedUrls.has(entry.arxivUrl)) {
    out.push({ type: "arXiv.org", text: entry.arxivUrl, url: entry.arxivUrl });
  }
  return out;
}

function PublicationToggle({ entry }: { entry: PublicationStructuredEntry }) {
  const authors =
    entry.authorsRich ?? (entry.authors ?? []).map((name) => ({ name, isSelf: false }));
  const venues = fallbackVenues(entry);
  const labels = entry.labels ?? [];
  const highlights = entry.highlights ?? [];

  return (
    <div className="notion-toggle closed publication-toggle">
      <div className="notion-toggle__summary" role="button" tabIndex={0} aria-expanded="false">
        <div className="notion-toggle__trigger">
          <div className="notion-toggle__trigger_icon">
            <span>‣</span>
          </div>
        </div>
        <span className="notion-semantic-string">
          <strong>{entry.title} </strong>
          {highlights.map((highlight) => (
            <span key={highlight} className="highlighted-color color-red">
              <strong>[{highlight}]</strong>
            </span>
          ))}
          {labels.length > 0 && (
            <>
              <br />
              {labels.map((label) => (
                <span key={label} className="pub-tag-prefix">
                  <PublicationTag label={label} />{" "}
                </span>
              ))}
            </>
          )}
        </span>
      </div>
      <div className="notion-toggle__content" hidden aria-hidden="true">
        {(authors.length > 0 || venues.length > 0) && (
          <blockquote className="notion-quote">
            <span className="notion-semantic-string">
              <AuthorsLine authors={authors} />
              {authors.length > 0 && venues.length > 0 && (
                <>
                  <br />
                  <br />
                </>
              )}
              {venues.map((venue, index) => (
                <span key={`${venue.type}-${index}`}>
                  {index > 0 && <br />}
                  <VenueLine venue={venue} />
                </span>
              ))}
            </span>
          </blockquote>
        )}
      </div>
    </div>
  );
}

export function PublicationList({ entries }: { entries: PublicationStructuredEntry[] }) {
  const groups = groupsByYear(entries);

  return (
    <>
      {groups.map(([year, items]) => (
        <section key={year} className="publication-year">
          <span className="notion-heading__anchor" />
          <h2 className="notion-heading notion-semantic-string">{year}</h2>
          {items.map((entry, index) => (
            <PublicationToggle key={`${year}-${index}-${entry.title}`} entry={entry} />
          ))}
        </section>
      ))}
    </>
  );
}
