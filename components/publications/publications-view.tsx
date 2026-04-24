import { Fragment } from "react";

import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import type { PublicationProfileLink } from "@/lib/publications/extract";
import type { SiteAdminStructuredPageSection } from "@/lib/site-admin/api-types";
import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { renderPostMarkdown } from "@/components/classic/markdown";
import { PUBLICATIONS_SECTIONS } from "@/lib/site-admin/page-sections";

import { PublicationList } from "./publication-list";

export async function PublicationsView({
  title,
  description,
  sections,
  profileLinks,
  entries,
}: {
  title: string;
  description?: string;
  sections?: SiteAdminStructuredPageSection[];
  profileLinks: PublicationProfileLink[];
  entries: PublicationStructuredEntry[];
}) {
  const layout = sections?.length ? sections : PUBLICATIONS_SECTIONS;
  return (
    <ClassicPageShell
      title={title}
      className="super-content page__publications parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/publications", label: title },
      ]}
    >
      {await Promise.all(
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
                <PublicationList entries={entries} />
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
      )}
    </ClassicPageShell>
  );
}
