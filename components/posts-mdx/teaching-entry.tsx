import "server-only";

import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface TeachingEntryProps {
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
      <strong>
        <u>{term}</u>
      </strong>
      <br />
      <span className="highlighted-color color-gray">{period}</span>
      <br />
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
