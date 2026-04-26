import "server-only";

import type { ReactElement } from "react";

import { classifyLabel, type LabelKind } from "@/components/publications/publication-card";

interface PubAuthor {
  name: string;
  isSelf?: boolean;
}

interface PubVenue {
  type?: string;
  text?: string;
  url?: string;
}

interface PubData {
  title?: string;
  year?: string;
  url?: string;
  doiUrl?: string;
  arxivUrl?: string;
  labels?: string[];
  authorsRich?: PubAuthor[];
  venues?: PubVenue[];
  highlights?: string[];
  externalUrls?: string[];
}

interface PublicationsEntryProps {
  /** Single-quoted JSON-encoded entry record. Mirrors the per-row
   * shape used by the legacy publication-list / publication-card. */
  data?: string;
}

function parseData(raw: string | undefined): PubData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as PubData;
  } catch {
    // fall through
  }
  return {};
}

function tagTone(kind: LabelKind): { color: string; background: string } {
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

function fallbackVenues(data: PubData): PubVenue[] {
  const venues = data.venues ?? [];
  const usedUrls = new Set(venues.map((v) => v.url).filter(Boolean) as string[]);
  const out = [...venues];
  if (data.doiUrl && !usedUrls.has(data.doiUrl)) {
    out.push({ type: "DOI", text: data.doiUrl, url: data.doiUrl });
  }
  if (data.arxivUrl && !usedUrls.has(data.arxivUrl)) {
    out.push({ type: "arXiv.org", text: data.arxivUrl, url: data.arxivUrl });
  }
  return out;
}

/** Server component for one publication on the publications page.
 * Lives as `<PublicationsEntry data='{...JSON...}' />` in
 * `content/pages/publications.mdx`. Renders identical markup to one
 * `<PublicationToggle>` of the legacy PublicationList so existing CSS
 * keeps working. */
export function PublicationsEntry({ data }: PublicationsEntryProps): ReactElement {
  const entry = parseData(data);
  const authors = entry.authorsRich ?? [];
  const venues = fallbackVenues(entry);
  const labels = entry.labels ?? [];
  const highlights = entry.highlights ?? [];
  const title = entry.title ?? "";

  return (
    <div className="notion-toggle closed publication-toggle">
      <div className="notion-toggle__summary">
        <div className="notion-toggle__trigger">
          <div className="notion-toggle__trigger_icon">
            <span>‣</span>
          </div>
        </div>
        <span className="notion-semantic-string">
          <strong>{title} </strong>
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
              {authors.length > 0 && (
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
              )}
              {authors.length > 0 && venues.length > 0 && (
                <>
                  <br />
                  <br />
                </>
              )}
              {venues.map((venue, index) => (
                <span key={`${venue.type ?? "src"}-${index}`}>
                  {index > 0 && <br />}
                  <PublicationTag label={venue.type || "source"} />
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
                        {venue.text ?? ""}
                      </a>
                    ) : (
                      venue.text ?? ""
                    )}
                  </span>
                </span>
              ))}
            </span>
          </blockquote>
        )}
      </div>
    </div>
  );
}
