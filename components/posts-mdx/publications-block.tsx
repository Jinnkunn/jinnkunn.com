import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import publicationsData from "@/content/publications.json";
import { ClassicLink } from "@/components/classic/classic-link";
import { renderPostMarkdown } from "@/components/classic/markdown";
import { PublicationList } from "@/components/publications/publication-list";
import { PUBLICATIONS_SECTIONS } from "@/lib/site-admin/page-sections";
import { normalizePublicationsData } from "@/lib/site-admin/publications-normalize";
import type { PublicationProfileLink } from "@/lib/publications/extract";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import type { SiteAdminStructuredPageSection } from "@/lib/site-admin/api-types";

interface PublicationsBlockProps {
  /** Cap rendered entries (newest first). Omit for all entries. */
  limit?: number;
}

// `normalizePublicationsData` returns the typed DTO shape; the public
// publication renderer expects the richer "structured" shape but the
// runtime fields are compatible — the original /publications page used
// the same cast. Keep the cast localized here so the call site is honest.
type PublicationsViewData = {
  description?: string;
  sections?: SiteAdminStructuredPageSection[];
  profileLinks: PublicationProfileLink[];
  entries: PublicationStructuredEntry[];
};

/** Server component rendered from MDX as `<PublicationsBlock />`. Reads
 * the canonical content/publications.json so any page can embed the
 * publications list. Mirrors the section iteration in the dedicated
 * /publications view (profileLinks, entries, richText) so existing CSS
 * keeps working — but without the page shell, which the embedding page
 * already provides. */
export async function PublicationsBlock({
  limit,
}: PublicationsBlockProps): Promise<ReactElement> {
  const { description, sections, profileLinks, entries } =
    normalizePublicationsData(publicationsData) as unknown as PublicationsViewData;
  const layout = sections?.length ? sections : PUBLICATIONS_SECTIONS;
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visibleEntries = cap ? entries.slice(0, cap) : entries;

  const rendered = await Promise.all(
    layout.map(async (section: SiteAdminStructuredPageSection) => {
      if (!section.enabled) return null;
      if (section.type === "profileLinks") {
        return profileLinks.length > 0 ? (
          <Fragment key={section.id}>
            <p className="notion-text notion-text__content notion-semantic-string">
              {profileLinks.map((link, index) => (
                <Fragment key={link.href}>
                  {index > 0 && (
                    <span className="highlighted-color color-default">
                      <span className="highlighted-background bg-default">
                        <strong>{" | "}</strong>
                      </span>
                    </span>
                  )}
                  <span className="highlighted-background bg-yellow">
                    <strong>
                      <ClassicLink href={link.href}>{link.label}</ClassicLink>
                    </strong>
                  </span>
                </Fragment>
              ))}
            </p>
            <div className="notion-text" aria-hidden="true" />
          </Fragment>
        ) : null;
      }
      if (section.type === "entries") {
        return (
          <Fragment key={section.id}>
            {section.title && (
              <h2 className="notion-heading notion-semantic-string">
                {section.title}
              </h2>
            )}
            <PublicationList entries={visibleEntries} />
          </Fragment>
        );
      }
      if (section.type === "richText") {
        const body = await renderPostMarkdown(section.body || description || "");
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
