import { Fragment } from "react";

import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import type { PublicationProfileLink } from "@/lib/publications/extract";

import { PublicationList } from "./publication-list";

export function PublicationsView({
  title,
  profileLinks,
  entries,
}: {
  title: string;
  profileLinks: PublicationProfileLink[];
  entries: PublicationStructuredEntry[];
}) {
  return (
    <main
      id="main-content"
      className="super-content page__publications parent-page__index"
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
        {profileLinks.length > 0 && (
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
                    <a
                      href={link.href}
                      className="notion-link link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}
                    </a>
                  </strong>
                </span>
              </Fragment>
            ))}
          </p>
        )}
        <PublicationList entries={entries} />
      </article>
    </main>
  );
}
