import "server-only";

import type { ReactElement } from "react";

import { classifyLabel, venueSummaryText, type LabelKind } from "@/components/publications/labels";
import { PublicationHighlightBadge } from "@/components/publications/publication-highlight-badge";
import { PublicationResourceLinks } from "@/components/publications/publication-resource-links";

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
   * shape used by the rendered publication-list. */
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

/** Server component for one publication on the publications page.
 * Lives as `<PublicationsEntry data='{...JSON...}' />` in
 * `content/pages/publications.mdx`. Renders identical markup to one
 * `<PublicationToggle>` of the legacy PublicationList so existing CSS
 * keeps working. */
export function PublicationsEntry({ data }: PublicationsEntryProps): ReactElement {
  const entry = parseData(data);
  const authors = entry.authorsRich ?? [];
  const venues = entry.venues ?? [];
  const labels = entry.labels ?? [];
  const highlights = entry.highlights ?? [];
  const primaryVenue = venues[0] ? venueSummaryText({ type: venues[0].type || "", text: venues[0].text || "" }) : "";
  const hasMetadata = labels.length > 0 || highlights.length > 0 || Boolean(primaryVenue);
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
          <span className="pub-title-line">
            <strong className="pub-title-text">{title}</strong>
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
                {primaryVenue ? <span className="highlighted-color color-gray">{primaryVenue}</span> : null}
              </span>
            </>
          )}
          <PublicationResourceLinks entry={entry} />
        </span>
      </div>
      <div className="notion-toggle__content" hidden aria-hidden="true">
        {(authors.length > 0 || venues.length > 1) && (
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
              {authors.length > 0 && venues.length > 1 && (
                <>
                  <br />
                  <br />
                </>
              )}
              {venues.slice(1).map((venue, index) => (
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
