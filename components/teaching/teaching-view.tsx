import "server-only";

import { Fragment } from "react";

import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import type { SiteAdminTeachingData } from "@/lib/site-admin/api-types";

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
              <a
                href={link.href}
                className="notion-link link"
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </a>
            </strong>
          </Fragment>
        );
      })}
    </p>
  );
}

export async function TeachingView({
  data,
}: {
  data: SiteAdminTeachingData;
}) {
  const Intro = data.intro
    ? (await compilePostMdx(data.intro)).Content
    : null;

  return (
    <main
      id="main-content"
      className="super-content page__teaching parent-page__index"
    >
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{data.title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        {Intro && (
          <blockquote className="notion-quote teaching-intro">
            <Intro components={postMdxComponents} />
          </blockquote>
        )}

        <LinkLine links={data.headerLinks} />

        {data.entries.length === 0 ? (
          <p className="notion-text notion-text__content notion-semantic-string">
            No teaching activities yet.
          </p>
        ) : (
          <ul className="teaching-list">
            {data.entries.map((entry, index) => (
              <li
                key={`${entry.term}-${entry.courseCode}-${index}`}
                className="teaching-item"
              >
                <div className="teaching-item__line">
                  <strong>{entry.term}</strong>{" "}
                  <span className="teaching-item__period">{entry.period}</span>{" "}
                  <strong>{entry.role}</strong> for{" "}
                  {entry.courseUrl ? (
                    <a
                      href={entry.courseUrl}
                      className="notion-link link"
                      {...(/^https?:\/\//.test(entry.courseUrl)
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      <strong>{entry.courseCode}</strong>
                    </a>
                  ) : (
                    <strong>{entry.courseCode}</strong>
                  )}{" "}
                  {entry.courseName && (
                    <>
                      (<span>{entry.courseName}</span>
                      {entry.instructor && (
                        <>
                          , <strong>{entry.instructor}</strong>
                        </>
                      )}
                      )
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {data.footerLinks.length > 0 && (
          <p className="notion-text notion-text__content notion-semantic-string teaching-footer-links">
            {data.footerLinks.map((link, index) => {
              const isExternal = /^https?:\/\//.test(link.href);
              return (
                <Fragment key={`${link.href}-${index}`}>
                  {index > 0 && (
                    <span className="teaching-link-divider"> · </span>
                  )}
                  <a
                    href={link.href}
                    className="notion-link link"
                    {...(isExternal
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {link.label}
                  </a>
                </Fragment>
              );
            })}
          </p>
        )}
      </article>
    </main>
  );
}
