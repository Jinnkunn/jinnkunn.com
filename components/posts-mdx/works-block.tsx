import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import worksData from "@/content/works.json";
import { ClassicLink } from "@/components/classic/classic-link";
import { renderPostMarkdown } from "@/components/classic/markdown";
import { WORKS_SECTIONS } from "@/lib/site-admin/page-sections";
import { normalizeWorksData } from "@/lib/site-admin/works-normalize";
import type {
  SiteAdminStructuredPageSection,
  WorksEntryDTO,
} from "@/lib/site-admin/api-types";

interface WorksBlockProps {
  /** Optional cap applied to each category (recent / passed) independently. */
  limit?: number;
}

function NotionSpacer() {
  return <div className="notion-text" aria-hidden="true" />;
}

/** Single toggle row for one work entry. Mirrors what WorksView used to
 * render — kept internal because nothing else needs it. */
function WorksToggle({
  entry,
  body,
}: {
  entry: WorksEntryDTO;
  body: ReactElement | null;
}) {
  const aff = entry.affiliation;
  const affNode = aff
    ? entry.affiliationUrl
      ? (
          <span className="highlighted-background bg-yellow">
            <strong>
              <ClassicLink
                href={entry.affiliationUrl}
                {...(/^https?:\/\//.test(entry.affiliationUrl)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {aff}
              </ClassicLink>
            </strong>
          </span>
        )
      : <strong>{aff}</strong>
    : null;

  return (
    <div className="notion-toggle closed works-toggle">
      <div className="notion-toggle__summary">
        <div className="notion-toggle__trigger">
          <div className="notion-toggle__trigger_icon">
            <span>‣</span>
          </div>
        </div>
        <span className="notion-semantic-string">
          <strong>
            <u>{entry.role}</u>
          </strong>
          {(affNode || entry.location || entry.period) && <br />}
          {affNode}
          {entry.location && (
            <span className="highlighted-color color-gray">
              {affNode ? ", " : ""}
              {entry.location}
            </span>
          )}
          {entry.period && (
            <>
              <br />
              <span className="highlighted-color color-gray">
                {entry.period.endsWith("Now") ? (
                  <>
                    {entry.period.slice(0, -3)}
                    <strong>Now</strong>
                  </>
                ) : (
                  entry.period
                )}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="notion-toggle__content" hidden aria-hidden="true">
        {body && <div className="mdx-post__body works-toggle__body">{body}</div>}
      </div>
    </div>
  );
}

/** Server component rendered from MDX as `<WorksBlock />`. Reads the
 * canonical content/works.json and renders the section-iterated body
 * (intro / recentWorks / passedWorks / note / richText). The chrome
 * (ClassicPageShell, breadcrumbs) stays in /works for that route, so
 * embedding the block elsewhere keeps the page clean. */
export async function WorksBlock({
  limit,
}: WorksBlockProps): Promise<ReactElement> {
  const data = normalizeWorksData(worksData);
  const Intro = data.intro ? await renderPostMarkdown(data.intro) : null;
  const Note = data.note ? await renderPostMarkdown(data.note) : null;
  const sections = data.sections?.length ? data.sections : WORKS_SECTIONS;
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const sliceCategory = (entries: WorksEntryDTO[]) =>
    cap ? entries.slice(0, cap) : entries;

  const recent = sliceCategory(data.entries.filter((e) => e.category === "recent"));
  const passed = sliceCategory(data.entries.filter((e) => e.category === "passed"));

  const recentRendered = await Promise.all(
    recent.map(async (entry) => ({
      entry,
      body: entry.description
        ? await renderPostMarkdown(entry.description)
        : null,
    })),
  );
  const passedRendered = await Promise.all(
    passed.map(async (entry) => ({
      entry,
      body: entry.description
        ? await renderPostMarkdown(entry.description)
        : null,
    })),
  );

  const rendered = await Promise.all(
    sections.map(async (section: SiteAdminStructuredPageSection) => {
      if (!section.enabled) return null;
      if (section.type === "intro") {
        return Intro ? (
          <Fragment key={section.id}>
            <blockquote className="notion-quote works-intro">{Intro}</blockquote>
            <NotionSpacer />
          </Fragment>
        ) : null;
      }
      if (section.type === "recentWorks") {
        return recent.length > 0 ? (
          <Fragment key={section.id}>
            <span className="notion-heading__anchor" />
            <h1 className="notion-heading notion-semantic-string">
              {section.title || "Recent Works"}
            </h1>
            {recentRendered.map((r, i) => (
              <WorksToggle
                key={`recent-${r.entry.role}-${i}`}
                entry={r.entry}
                body={r.body}
              />
            ))}
          </Fragment>
        ) : null;
      }
      if (section.type === "passedWorks") {
        return passed.length > 0 ? (
          <Fragment key={section.id}>
            <span className="notion-heading__anchor" />
            <h1 className="notion-heading notion-semantic-string">
              {section.title || "Passed Works"}
            </h1>
            {passedRendered.map((r, i) => (
              <WorksToggle
                key={`passed-${r.entry.role}-${i}`}
                entry={r.entry}
                body={r.body}
              />
            ))}
          </Fragment>
        ) : null;
      }
      if (section.type === "note") {
        return Note ? (
          <Fragment key={section.id}>
            <NotionSpacer />
            <blockquote className="notion-quote works-note">{Note}</blockquote>
          </Fragment>
        ) : null;
      }
      if (section.type === "richText") {
        const body = await renderPostMarkdown(section.body || "");
        return body ? (
          <Fragment key={section.id}>
            {section.title && (
              <h1 className="notion-heading notion-semantic-string">
                {section.title}
              </h1>
            )}
            <div className="mdx-post__body">{body}</div>
          </Fragment>
        ) : null;
      }
      return null;
    }),
  );

  return <>{rendered}</>;
}
