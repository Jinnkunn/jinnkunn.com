import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import teachingData from "@/content/teaching.json";
import { ClassicLink } from "@/components/classic/classic-link";
import { renderPostMarkdown } from "@/components/classic/markdown";
import { TEACHING_SECTIONS } from "@/lib/site-admin/page-sections";
import { normalizeTeachingData } from "@/lib/site-admin/teaching-normalize";
import type {
  SiteAdminStructuredPageSection,
  SiteAdminTeachingData,
} from "@/lib/site-admin/api-types";

interface TeachingBlockProps {
  /** Cap rendered teaching entries (newest first). Omit for all entries. */
  limit?: number;
}

function NotionSpacer() {
  return <div className="notion-text" aria-hidden="true" />;
}

function LinkLine({
  links,
}: {
  links: SiteAdminTeachingData["headerLinks"];
}) {
  if (links.length === 0) return null;
  return (
    <p className="notion-text notion-text__content notion-semantic-string">
      {links.map((link, index) => {
        const isExternal = /^https?:\/\//.test(link.href);
        return (
          <Fragment key={`${link.href}-${index}`}>
            {index > 0 && (
              <strong className="teaching-link-divider"> | </strong>
            )}
            <strong>
              <ClassicLink
                href={link.href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </ClassicLink>
            </strong>
          </Fragment>
        );
      })}
    </p>
  );
}

/** Server component rendered from MDX as `<TeachingBlock />`. Reads
 * the canonical content/teaching.json and renders the section
 * iteration (intro / headerLinks / entries / footerLinks / richText)
 * — without ClassicPageShell, which the embedding page provides. */
export async function TeachingBlock({
  limit,
}: TeachingBlockProps): Promise<ReactElement> {
  const data = normalizeTeachingData(teachingData);
  const Intro = data.intro ? await renderPostMarkdown(data.intro) : null;
  const sections = data.sections?.length ? data.sections : TEACHING_SECTIONS;
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visibleEntries = cap ? data.entries.slice(0, cap) : data.entries;

  const TeachingList =
    visibleEntries.length === 0 ? (
      <p className="notion-text notion-text__content notion-semantic-string">
        No teaching activities yet.
      </p>
    ) : (
      <ul className="notion-bulleted-list teaching-list">
        {visibleEntries.map((entry, index) => (
          <li
            key={`${entry.term}-${entry.courseCode}-${index}`}
            className="notion-list-item notion-semantic-string teaching-item"
          >
            <strong>
              <u>{entry.term}</u>
            </strong>
            <br />
            <span className="highlighted-color color-gray">
              {entry.period}
            </span>
            <br />
            <strong>{entry.role}</strong>
            <span className="highlighted-color color-gray"> for </span>
            {entry.courseUrl ? (
              <span className="highlighted-background bg-yellow">
                <strong>
                  <ClassicLink
                    href={entry.courseUrl}
                    {...(/^https?:\/\//.test(entry.courseUrl)
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {entry.courseCode}
                  </ClassicLink>
                </strong>
              </span>
            ) : (
              <span className="highlighted-color color-gray">{entry.courseCode}</span>
            )}
            {entry.courseName && (
              <span className="highlighted-color color-gray">
                {" "}
                ({entry.courseName}
                {entry.instructor && (
                  <>
                    , <strong>{entry.instructor}</strong>
                  </>
                )}
                )
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  const FooterLinks =
    data.footerLinks.length > 0 ? (
      <p className="notion-text notion-text__content notion-semantic-string teaching-footer-links">
        {data.footerLinks.map((link, index) => {
          const isExternal = /^https?:\/\//.test(link.href);
          return (
            <Fragment key={`${link.href}-${index}`}>
              {index > 0 && <span className="teaching-link-divider"> · </span>}
              <ClassicLink
                href={link.href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </ClassicLink>
            </Fragment>
          );
        })}
      </p>
    ) : null;

  const rendered = await Promise.all(
    sections.map(async (section: SiteAdminStructuredPageSection) => {
      if (!section.enabled) return null;
      if (section.type === "intro") {
        return Intro ? (
          <Fragment key={section.id}>
            <blockquote className="notion-quote teaching-intro">{Intro}</blockquote>
          </Fragment>
        ) : null;
      }
      if (section.type === "headerLinks") {
        return data.headerLinks.length > 0 ? (
          <Fragment key={section.id}>
            <LinkLine links={data.headerLinks} />
          </Fragment>
        ) : null;
      }
      if (section.type === "entries") {
        return (
          <Fragment key={section.id}>
            <NotionSpacer />
            {section.title && (
              <h2 className="notion-heading notion-semantic-string">
                {section.title}
              </h2>
            )}
            {TeachingList}
          </Fragment>
        );
      }
      if (section.type === "footerLinks") {
        return FooterLinks ? (
          <Fragment key={section.id}>
            <NotionSpacer />
            {FooterLinks}
          </Fragment>
        ) : null;
      }
      if (section.type === "richText") {
        const body = await renderPostMarkdown(section.body);
        return body ? (
          <Fragment key={section.id}>
            {section.title && (
              <h2 className="notion-heading notion-semantic-string">
                {section.title}
              </h2>
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
