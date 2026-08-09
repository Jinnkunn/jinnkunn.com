import "server-only";

import type { ReactElement, ReactNode } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface WorksEntryProps {
  /** Stable editor identity. It is intentionally not rendered. */
  entryId?: string;
  /** Partition key — `recent` puts the entry in the active list,
   * `passed` in the archive. Drives no styling on its own; the
   * surrounding page (and the WorksBlock embed) groups by category. */
  category?: "recent" | "passed";
  /** Bold-underlined headline — typically the role / position. */
  role?: string;
  /** Affiliation label rendered next to the role (yellow highlight if
   * a URL is set, plain bold otherwise). */
  affiliation?: string;
  /** When set, wraps the affiliation in a `<ClassicLink>` and adds the
   * external-link affordance for `https?://` URLs. */
  affiliationUrl?: string;
  /** Optional location, rendered in muted gray after the affiliation. */
  location?: string;
  /** Period string. Trailing "Now" gets emphasized via a nested
   * `<strong>` so the active-role indicator matches the legacy block. */
  period?: string;
  /** Description body — markdown-compiled MDX content. The toggle's
   * collapsed-by-default chrome stays the same as the legacy
   * WorksBlock; expansion is driven by the existing `notion-toggle`
   * JS picked up by ClassicPageShell. */
  children?: ReactNode;
}

/** One work / role entry on the works page. With a description body it
 * renders identical markup to the legacy WorksToggle inside WorksBlock so
 * existing CSS (`notion-toggle closed works-toggle`, `works-toggle__body`)
 * keeps working untouched. Without one it renders a static, non-interactive
 * row instead (`works-toggle--static`). Lives as
 * `<WorksEntry [...]>body</WorksEntry>` in `content/pages/works.mdx`. */
export function WorksEntry({
  role,
  affiliation,
  affiliationUrl,
  location,
  period,
  children,
}: WorksEntryProps): ReactElement {
  const hasBody = Boolean(children);
  const aff = affiliation ?? "";
  const affNode = aff ? (
    affiliationUrl ? (
      <span className="highlighted-background bg-yellow">
        <strong>
          <ClassicLink
            href={affiliationUrl}
            {...(/^https?:\/\//.test(affiliationUrl)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {aff}
          </ClassicLink>
        </strong>
      </span>
    ) : (
      <strong>{aff}</strong>
    )
  ) : null;

  const summary = (
    <span className="notion-semantic-string">
      <strong>
        <u>{role ?? ""}</u>
      </strong>
      {(affNode || location || period) && <br />}
      {affNode}
      {location && (
        <span className="highlighted-color color-gray">
          {affNode ? ", " : ""}
          {location}
        </span>
      )}
      {period && (
        <>
          <br />
          <span className="highlighted-color color-gray">
            {period.endsWith("Now") ? (
              <>
                {period.slice(0, -3)}
                <strong>Now</strong>
              </>
            ) : (
              period
            )}
          </span>
        </>
      )}
    </span>
  );

  // An entry with no description is not a disclosure widget. The
  // `notion-toggle__summary` wrapper is what notion-block-behavior binds its
  // click delegation to, so keeping it (even with an empty content box) left
  // the row clickable and expanding onto nothing — the wrapper has to go, not
  // just the arrow. works.css re-supplies the box model the two dropped
  // Notion classes were providing so a static row still lines up with its
  // expandable siblings.
  if (!hasBody) {
    return (
      <div className="works-toggle works-toggle--static">
        <div className="works-toggle__static-summary">
          <div className="works-toggle__static-spacer" aria-hidden="true" />
          {summary}
        </div>
      </div>
    );
  }

  return (
    <div className="notion-toggle closed works-toggle">
      <div className="notion-toggle__summary">
        <div className="notion-toggle__trigger">
          <div className="notion-toggle__trigger_icon">
            <span>‣</span>
          </div>
        </div>
        {summary}
      </div>
      <div className="notion-toggle__content" hidden aria-hidden="true">
        <div className="mdx-post__body works-toggle__body">{children}</div>
      </div>
    </div>
  );
}
