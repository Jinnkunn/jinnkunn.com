import "server-only";

import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface TeachingEntryProps {
  /** Stable editor identity. It is intentionally not rendered. */
  entryId?: string;
  /** Term label (e.g. "Fall 2024") — bold-underlined heading. */
  term?: string;
  period?: string;
  role?: string;
  courseCode?: string;
  courseName?: string;
  /** When set, the courseCode is rendered as a yellow-highlighted
   * link to this URL; external URLs (`https?:`) get the
   * `target="_blank"` affordance. */
  courseUrl?: string;
  instructor?: string;
  /** Grouped TeachingBlock entries put their shared term above the list. */
  showTerm?: boolean;
}

/** One row on the teaching page. Lives as a self-closing
 * `<TeachingEntry term="..." period="..." role="..." courseCode="..."
 * courseName="..." courseUrl="..." instructor="..." />` in
 * `content/pages/teaching.mdx`, wrapped by an `<ul
 * className="notion-bulleted-list teaching-list">` the page MDX
 * provides. Markup mirrors one `<li>` of the legacy TeachingBlock so
 * the existing CSS in `app/(classic)/teaching.css` keeps applying
 * without changes. */
export function TeachingEntry({
  term = "",
  period = "",
  role = "",
  courseCode = "",
  courseName = "",
  courseUrl,
  instructor,
  showTerm = true,
}: TeachingEntryProps): ReactElement {
  const courseLabel =
    courseUrl ? (
      <span className="highlighted-background bg-yellow">
        <strong>
          <ClassicLink
            href={courseUrl}
            {...(/^https?:\/\//.test(courseUrl)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {courseCode}
          </ClassicLink>
        </strong>
      </span>
    ) : (
      <span className="highlighted-color color-gray">{courseCode}</span>
    );

  return (
    <li className="notion-list-item notion-semantic-string teaching-item">
      {showTerm && term ? <><strong><u>{term}</u></strong><br /></> : null}
      {period ? <><span className="highlighted-color color-gray">{period}</span><br /></> : null}
      <strong>{role}</strong>
      <span className="highlighted-color color-gray"> for </span>
      {courseLabel}
      {courseName && (
        <span className="highlighted-color color-gray">
          {" "}
          ({courseName}
          {instructor && (
            <>
              , <strong>{instructor}</strong>
            </>
          )}
          )
        </span>
      )}
    </li>
  );
}
