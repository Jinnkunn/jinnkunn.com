import { Fragment } from "react";

import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import type { BlogPostIndexItem } from "@/lib/blog";

import { BlogIndexList } from "./blog-index-list";

export type BlogIntroLink = {
  label: string;
  href: string;
};

export function BlogIndexView({
  title,
  introLinks,
  entries,
}: {
  title: string;
  introLinks: BlogIntroLink[];
  entries: BlogPostIndexItem[];
}) {
  return (
    <ClassicPageShell
      title={title}
      className="super-content page__blog parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/blog", label: title },
      ]}
    >
      {introLinks.length > 0 && (
        <p className="notion-text notion-text__content notion-semantic-string">
          {introLinks.map((link, index) => (
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
                  <span data-link-style="icon">
                    <ClassicLink href={link.href}>{link.label}</ClassicLink>
                  </span>
                </strong>
              </span>
            </Fragment>
          ))}
        </p>
      )}
      <div className="notion-text" aria-hidden="true" />
      <BlogIndexList entries={entries} />
    </ClassicPageShell>
  );
}
