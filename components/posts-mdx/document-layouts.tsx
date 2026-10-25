/* eslint-disable @next/next/no-html-link-for-pages -- Public static-shell navigation. */
import { Fragment, type ReactNode } from "react";
import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import type { PostEntry } from "@jinnkunn/content-core/posts";
import { formatLongDate } from "@jinnkunn/content-core/posts";
import type { PageEntry } from "@jinnkunn/content-core/pages";
import { shouldShowPostOutline, type PostHeading } from "@/lib/posts/outline";

export type DocumentBreadcrumb = { label: string; href: string | null };
export type AdjacentPost = { href: string; title: string };

function Breadcrumbs({ trail }: { trail: DocumentBreadcrumb[] }) {
  return <div className="super-navbar__breadcrumbs"><div className="notion-breadcrumb">
    <a href="/" className="notion-link notion-breadcrumb__item"><div className="notion-navbar__title notion-breadcrumb__title">Home</div></a>
    {trail.map((item, index) => <Fragment key={`${item.href ?? "noref"}-${index}`}>
      <span className="notion-breadcrumb__divider">/</span>
      {item.href ? <a href={item.href} className="notion-link notion-breadcrumb__item"><div className="notion-navbar__title notion-breadcrumb__title">{item.label}</div></a>
        : <div className="notion-breadcrumb__item notion-breadcrumb__item--placeholder"><div className="notion-navbar__title notion-breadcrumb__title">{item.label}</div></div>}
    </Fragment>)}
  </div></div>;
}

export function PostArticle({ entry, headings, children, prev = null, next = null }: {
  entry: PostEntry; headings: PostHeading[]; children: ReactNode; prev?: AdjacentPost | null; next?: AdjacentPost | null;
}) {
  return <ClassicPageShell title={entry.title || "Untitled Post"} className="super-content page__blog-post parent-page__blog-post"
    beforeHeader={<Breadcrumbs trail={[{ label: "Blog", href: "/blog" }, { label: entry.title || "Untitled Post", href: entry.href }]} />}>
    <div className="notion-page__properties mdx-post__meta ds-property-strip" aria-label="Post metadata">
      <div className="notion-page__property mdx-post__meta-item ds-property-strip__item"><div className="notion-property notion-property__date notion-semantic-string ds-property-strip__property">
        <span className="notion-property__date-icon" aria-hidden="true" />
        {entry.dateIso ? <time className="date" dateTime={entry.dateIso}>{entry.dateText}</time> : <span className="date">Date not set</span>}
      </div></div>
      {entry.readingMinutes > 0 ? <div className="notion-page__property mdx-post__meta-item ds-property-strip__item"><div className="notion-property notion-semantic-string ds-property-strip__property">
        <span className="mdx-post__reading-icon" aria-hidden="true" /><span className="mdx-post__reading">{entry.readingMinutes} min read</span>
      </div></div> : null}
    </div>
    {shouldShowPostOutline(entry.wordCount, headings) ? <details className="mdx-post__outline">
      <summary><span>On this page</span><span data-toc-current>Overview</span></summary>
      <nav aria-label="Article contents"><ul className="notion-table-of-contents">{headings.map((heading) => <li key={heading.id} className="notion-table-of-contents__item" data-toc-target={heading.id} data-level={heading.level}>
        <a href={`#${encodeURIComponent(heading.id)}`} className="notion-link"><span className="notion-semantic-string">{heading.title}</span></a>
      </li>)}</ul></nav>
    </details> : null}
    <div className="mdx-post__body">{children}</div>
    <nav className="notion-text notion-text__content notion-semantic-string mdx-post__nav" aria-label="More blog posts">
      {prev ? <><span className="highlighted-color color-gray">← Previous: </span><ClassicLink href={prev.href} rel="prev">{prev.title}</ClassicLink><br /></> : null}
      {next ? <><span className="highlighted-color color-gray">Next → </span><ClassicLink href={next.href} rel="next">{next.title}</ClassicLink><br /></> : null}
      <ClassicLink href="/blog">All posts</ClassicLink>
    </nav>
  </ClassicPageShell>;
}

export function PageArticle({ entry, trail, children }: { entry: PageEntry; trail: DocumentBreadcrumb[]; children: ReactNode }) {
  return <ClassicPageShell title={entry.title || "Untitled Page"} className="super-content page__mdx-page parent-page__mdx-page" beforeHeader={<Breadcrumbs trail={trail} />}>
    {entry.updatedIso ? <div className="notion-page__properties mdx-post__meta ds-property-strip" aria-label="Page metadata">
      <div className="notion-page__property mdx-post__meta-item ds-property-strip__item"><div className="notion-property notion-property__date notion-semantic-string ds-property-strip__property">
        <span className="notion-property__date-icon" aria-hidden="true" /><span className="date">Updated <time dateTime={entry.updatedIso}>{formatLongDate(entry.updatedIso)}</time></span>
      </div></div>
    </div> : null}
    <div className="mdx-post__body">{children}</div>
  </ClassicPageShell>;
}

export function HomeArticle({ title, children }: { title: string; children: ReactNode }) {
  return <ClassicPageShell title={title} className="super-content page__index parent-page__index">{children ? <div className="mdx-post__body">{children}</div> : null}</ClassicPageShell>;
}
