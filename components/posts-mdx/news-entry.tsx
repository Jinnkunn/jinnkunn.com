import "server-only";

import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatDateHeading(iso: string): string {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return iso;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

interface NewsEntryProps {
  /** Stable editor identity. It is intentionally not rendered. */
  entryId?: string;
  /** Entry date in YYYY-MM-DD form. Used both for the rendered heading
   * and (by NewsBlock) for chronological sort order. */
  date?: string;
  children?: ReactNode;
}

/** One dated entry on the news page. Lives as a child block inside
 * `content/pages/news.mdx` (`<NewsEntry date="...">body</NewsEntry>`)
 * and renders identical markup to one entry of the legacy NewsBlock so
 * existing CSS (`news-entry__body`, `notion-heading`) keeps working
 * without touching styles.
 *
 * The wrapping `<div className="news-block">` that NewsBlock used to
 * emit around the whole list is intentionally absent here — the page
 * itself is the list, so adjacent <NewsEntry> siblings flow as siblings
 * in the rendered page. The CSS class only existed for spacing rules
 * that are now handled by the surrounding `.notion-root` / `.mdx-post__body`
 * cadence. */
export function NewsEntry({ date, children }: NewsEntryProps): ReactElement {
  const safeDate = typeof date === "string" ? date : "";
  return (
    <Fragment>
      <span className="notion-heading__anchor" />
      {/* A date is a label, not a document heading: as an <h3> every entry
        * announced a 13px "heading" whose whole text was a date, so /news
        * exposed a dozen meaningless outline entries. It keeps the
        * `notion-heading` class (all of the visible typography lives there
        * and in news.css) plus a `news-entry__date` hook that restores the
        * one value the h3 *tag* was supplying — see news.css. */}
      <div className="notion-heading notion-semantic-string news-entry__date">
        {ISO_DATE_RE.test(safeDate) ? (
          <time dateTime={safeDate}>{formatDateHeading(safeDate)}</time>
        ) : (
          formatDateHeading(safeDate)
        )}
      </div>
      <div className="news-entry__body mdx-post__body">{children}</div>
    </Fragment>
  );
}
