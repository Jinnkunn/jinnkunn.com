import { Fragment } from "react";

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
    <main
      id="main-content"
      className="super-content page__blog parent-page__index"
    >
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        {introLinks.length > 0 && (
          <p className="notion-text notion-text__content notion-semantic-string">
            {introLinks.map((link, index) => {
              const isExternal = /^https?:\/\//i.test(link.href);
              const anchorProps = isExternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {};
              return (
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
                      <a
                        href={link.href}
                        className="notion-link link"
                        {...anchorProps}
                      >
                        {link.label}
                      </a>
                    </strong>
                  </span>
                </Fragment>
              );
            })}
          </p>
        )}
        <BlogIndexList entries={entries} />
      </article>
    </main>
  );
}
