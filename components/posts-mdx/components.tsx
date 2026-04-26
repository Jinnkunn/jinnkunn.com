import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import type { MDXComponents } from "mdx/types";

import { ClassicLink } from "@/components/classic/classic-link";
import { Bookmark } from "./bookmark";
import { Callout } from "./callout";
import { Color } from "./color";
import { Column, Columns } from "./columns";
import { Embed } from "./embed";
import { FeaturedPagesBlock } from "./featured-pages-block";
import { Figure } from "./figure";
import { FileLink } from "./file-link";
import { HeroBlock } from "./hero-block";
import { LinkListBlock } from "./link-list-block";
import { NewsBlock } from "./news-block";
import { NewsEntry } from "./news-entry";
import { PageLink } from "./page-link";
import { PublicationsBlock } from "./publications-block";
import { PublicationsEntry } from "./publications-entry";
import { PublicationsProfileLinks } from "./publications-profile-links";
import { TeachingBlock } from "./teaching-block";
import { TeachingEntry } from "./teaching-entry";
import { TeachingLinks } from "./teaching-links";
import { Toggle } from "./toggle";
import { Video } from "./video";
import { WorksBlock } from "./works-block";
import { WorksEntry } from "./works-entry";

function joinClassNames(...classNames: (string | undefined)[]): string {
  return classNames.filter(Boolean).join(" ");
}

function MdxLink({
  href,
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (className?.split(/\s+/).includes("notion-heading__anchor-link")) {
    return (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    );
  }

  const classes = joinClassNames("notion-link link", className);
  if (!href) {
    return (
      <a className={classes} {...props}>
        {children}
      </a>
    );
  }

  return (
    <ClassicLink href={href} className={classes} {...props}>
      {children}
    </ClassicLink>
  );
}

function MdxPre({ children, className, ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <div className="notion-code no-wrap mdx-code">
      <button type="button" className="notion-code__copy-button">
        <svg className="notion-icon notion-icon__copy" viewBox="0 0 14 16" aria-hidden="true">
          <path d="M2.404 15.322h5.701c1.26 0 1.887-.662 1.887-1.927V12.38h1.154c1.254 0 1.91-.662 1.91-1.928V5.555c0-.774-.158-1.266-.626-1.74L9.512.837C9.066.387 8.545.21 7.865.21H5.463c-1.254 0-1.91.662-1.91 1.928v1.084H2.404c-1.254 0-1.91.668-1.91 1.933v8.239c0 1.265.656 1.927 1.91 1.927zm7.588-6.62c0-.792-.1-1.161-.592-1.665L6.225 3.814c-.452-.462-.844-.58-1.5-.591V2.215c0-.533.28-.832.843-.832h2.38v2.883c0 .726.386 1.113 1.107 1.113h2.83v4.998c0 .539-.276.832-.844.832H9.992V8.701zm-.79-4.29c-.206 0-.288-.088-.288-.287V1.594l2.771 2.818H9.201zM2.503 14.15c-.563 0-.844-.293-.844-.832V5.232c0-.539.281-.837.85-.837h1.91v3.187c0 .85.416 1.26 1.26 1.26h3.14v4.476c0 .54-.28.832-.843.832H2.504zM5.79 7.816c-.24 0-.346-.105-.346-.345V4.547l3.223 3.27H5.791z" />
        </svg>
        Copy
      </button>
      <pre className={className} {...props}>
        {children}
      </pre>
    </div>
  );
}

// Components exposed to MDX. Most native HTML elements render as plain HTML
// and inherit the existing Notion/classic CSS. Code blocks are wrapped with the
// legacy Notion code shell so copy/highlight behavior remains available.
export const postMdxComponents: MDXComponents = {
  a: MdxLink,
  pre: MdxPre,
  Bookmark,
  Callout,
  Color,
  Column,
  Columns,
  Embed,
  FeaturedPagesBlock,
  Figure,
  FileLink,
  HeroBlock,
  LinkListBlock,
  NewsBlock,
  NewsEntry,
  PageLink,
  PublicationsBlock,
  PublicationsEntry,
  PublicationsProfileLinks,
  TeachingBlock,
  TeachingEntry,
  TeachingLinks,
  Toggle,
  Video,
  WorksBlock,
  WorksEntry,
};
