import "server-only";

import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";

function formatDateHeading(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

interface NewsEntryProps {
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
      <h3 className="notion-heading notion-semantic-string">
        {formatDateHeading(safeDate)}
      </h3>
      <div className="news-entry__body mdx-post__body">{children}</div>
    </Fragment>
  );
}
