/* eslint-disable @next/next/no-html-link-for-pages -- Public pages use static-shell document navigation on Cloudflare Workers Free. */
import "server-only";

import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import type { BlogPostIndexItem } from "@/lib/blog";
import type { PostEntry } from "@jinnkunn/content-core/posts";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";

export async function PostView({
  entry,
  source,
  prev = null,
  next = null,
}: {
  entry: PostEntry;
  source: string;
  /** Newer post in the index, i.e. the one above this row on /blog. */
  prev?: BlogPostIndexItem | null;
  /** Older post in the index. */
  next?: BlogPostIndexItem | null;
}) {
  const { Content } = await compilePostMdx(source);

  return (
    <ClassicPageShell
      title={entry.title}
      className="super-content page__blog-post parent-page__blog-post"
      beforeHeader={
        <div className="super-navbar__breadcrumbs">
          <div className="notion-breadcrumb">
            <a href="/" className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">Home</div>
            </a>
            <span className="notion-breadcrumb__divider">/</span>
            <a href="/blog" className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">Blog</div>
            </a>
            <span className="notion-breadcrumb__divider">/</span>
            <a href={entry.href} className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">
                {entry.title}
              </div>
            </a>
          </div>
        </div>
      }
    >
      <div
        className="notion-page__properties mdx-post__meta ds-property-strip"
        aria-label="Post metadata"
      >
        <div className="notion-page__property mdx-post__meta-item ds-property-strip__item">
          <div className="notion-property notion-property__date notion-semantic-string ds-property-strip__property">
            <span className="notion-property__date-icon" aria-hidden="true" />
            <time className="date" dateTime={entry.dateIso}>
              {entry.dateText}
            </time>
          </div>
        </div>
        {entry.readingMinutes > 0 && (
          <div className="notion-page__property mdx-post__meta-item ds-property-strip__item">
            <div className="notion-property notion-semantic-string ds-property-strip__property">
              <span className="mdx-post__reading-icon" aria-hidden="true" />
              <span className="mdx-post__reading">{entry.readingMinutes} min read</span>
            </div>
          </div>
        )}
      </div>
      <div className="mdx-post__body">
        <Content components={postMdxComponents} />
      </div>
      {/* Posts used to dead-end: the article closed and the only way onward
        * was the breadcrumb. This reuses the Notion text vocabulary rather
        * than introducing a card/pager component, so it inherits the
        * `.notion-text` rhythm and the standard link recipe with no new CSS. */}
      <nav
        className="notion-text notion-text__content notion-semantic-string mdx-post__nav"
        aria-label="More blog posts"
      >
        {prev && (
          <>
            <span className="highlighted-color color-gray">← Previous: </span>
            <ClassicLink href={prev.href} rel="prev">
              {prev.title}
            </ClassicLink>
            <br />
          </>
        )}
        {next && (
          <>
            <span className="highlighted-color color-gray">Next → </span>
            <ClassicLink href={next.href} rel="next">
              {next.title}
            </ClassicLink>
            <br />
          </>
        )}
        <ClassicLink href="/blog">All posts</ClassicLink>
      </nav>
    </ClassicPageShell>
  );
}
