import type {
  PublicationAuthor,
  PublicationStructuredEntry,
  PublicationVenue,
} from "@/lib/seo/publications-items";

export type LabelKind = "conference" | "journal" | "arxiv" | "workshop" | "other";

export function classifyLabel(label: string): LabelKind {
  const key = label.toLowerCase().trim();
  if (key === "conference") return "conference";
  if (key === "journal") return "journal";
  if (key === "workshop") return "workshop";
  if (key === "arxiv.org" || key === "arxiv") return "arxiv";
  return "other";
}

function AuthorsLine({ authors }: { authors: PublicationAuthor[] }) {
  if (authors.length === 0) return null;
  return (
    <p className="pub-card__authors">
      {authors.map((author, index) => (
        <span
          key={`${author.name}-${index}`}
          className={author.isSelf ? "pub-card__author is-self" : "pub-card__author"}
        >
          {author.name}
          {index < authors.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

function stripVenueBoilerplate(text: string): string {
  return text
    .replace(/\b(https?:\/\/\S+)/gi, "")
    .replace(/\s*\b(dio|doi)\s*:?\s*10\.[0-9]+\/\S+/gi, "")
    .replace(/\b(dio|doi)\s*:?\s*$/i, "")
    .replace(/\b(available at)\s*:?\s*$/i, "")
    .replace(/[\s.,:;]+$/u, "")
    .replace(/^[\s.,:;]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function VenueRow({ venue }: { venue: PublicationVenue }) {
  const kind = classifyLabel(venue.type);
  const cleaned = stripVenueBoilerplate(venue.text);
  const display = cleaned || (kind === "arxiv" ? "arXiv preprint" : venue.text);
  const content = (
    <>
      <span className={`pub-card__venue-label pub-card__venue-label--${kind}`}>{venue.type}</span>
      <span className="pub-card__venue-text">{display}</span>
    </>
  );
  if (venue.url) {
    return (
      <a
        className="pub-card__venue pub-card__venue--link"
        href={venue.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </a>
    );
  }
  return <span className="pub-card__venue">{content}</span>;
}

export function PublicationCard({ entry }: { entry: PublicationStructuredEntry }) {
  const authors = entry.authorsRich ?? (entry.authors ?? []).map((name) => ({ name, isSelf: false }));
  const venues = entry.venues ?? [];
  const tagKinds = Array.from(new Set((entry.labels ?? []).map(classifyLabel)));
  const highlights = entry.highlights ?? [];

  // Fallback: if no venue carries a URL but doiUrl / arxivUrl exist, expose them
  // as non-typed venue rows so the row is still reachable.
  const usedUrls = new Set(venues.map((v) => v.url).filter(Boolean) as string[]);
  const fallbackVenues: PublicationVenue[] = [];
  if (entry.doiUrl && !usedUrls.has(entry.doiUrl)) {
    fallbackVenues.push({ type: "DOI", text: entry.doiUrl.replace(/^https?:\/\/(?:www\.)?/i, ""), url: entry.doiUrl });
  }
  if (entry.arxivUrl && !usedUrls.has(entry.arxivUrl)) {
    fallbackVenues.push({ type: "arXiv.org", text: "arXiv preprint", url: entry.arxivUrl });
  }
  const allVenues = [...venues, ...fallbackVenues];

  return (
    <article className="pub-card" data-kinds={tagKinds.join(" ")}>
      <div className="pub-card__head">
        <h3 className="pub-card__title">{entry.title}</h3>
        {highlights.length > 0 && (
          <div className="pub-card__highlights">
            {highlights.map((highlight) => (
              <span key={`h-${highlight}`} className="pub-card__highlight">
                {highlight}
              </span>
            ))}
          </div>
        )}
      </div>
      <AuthorsLine authors={authors} />
      {allVenues.length > 0 && (
        <ul className="pub-card__venues">
          {allVenues.map((venue, index) => (
            <li key={`${venue.type}-${index}`}>
              <VenueRow venue={venue} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
