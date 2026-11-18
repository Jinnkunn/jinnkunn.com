import { Fragment } from "react";

import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import type { BlogPostIndexItem } from "@/lib/blog";
import type { SeriesLink } from "@/lib/posts/reasoning-drift-series";

import { BlogIndexList } from "./blog-index-list";
import { ReasoningDriftSeries } from "./reasoning-drift-series";

export type BlogIntroLink = {
  label: string;
  href: string;
};

export function BlogIndexView({
  title,
  introLinks,
  entries,
  series = [],
}: {
  title: string;
  introLinks: BlogIntroLink[];
  entries: BlogPostIndexItem[];
  series?: SeriesLink[];
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
      <ReasoningDriftSeries entries={series} />
      <div className="notion-text" aria-hidden="true" />
      <BlogIndexList entries={entries} />
    </ClassicPageShell>
  );
}
