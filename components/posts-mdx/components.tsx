import type { AnchorHTMLAttributes, CSSProperties, HTMLAttributes } from "react";
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

type IconStyleProperties = CSSProperties & {
  "--link-icon-image"?: string;
};

// Hostnames the icon-url renderer is allowed to embed. The icon URL gets
// inlined into a CSS `url(...)` value (the link-icon background), so any
// domain we accept here can quietly fetch from a visitor's browser. The
// list is conservative on purpose: same-origin (relative paths), the
// site's own CDN, plus the few favicon services we actually use in
// admin-authored content. Add a host here only after auditing what
// payloads it can return.
const ICON_URL_ALLOWED_HOSTS = new Set<string>([
  "cdn.jinkunchen.com",
  "jinkunchen.com",
  "staging.jinkunchen.com",
  "www.google.com", // s2/favicons
  "icons.duckduckgo.com",
]);

function isSafeIconUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ICON_URL_ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

function MdxSpan({
  children,
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  "data-link-icon"?: string;
  "data-link-style"?: string;
}) {
  const iconUrl =
    typeof props["data-link-icon"] === "string" ? props["data-link-icon"].trim() : "";
  const nextStyle: IconStyleProperties =
    props["data-link-style"] === "icon" && iconUrl && isSafeIconUrl(iconUrl)
      ? {
          ...style,
          "--link-icon-image": `url(${JSON.stringify(iconUrl)})`,
        }
      : style ?? {};
  return (
    <span {...props} style={nextStyle}>
      {children}
    </span>
  );
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
  // The copy icon used to live as a 600+ char inline <svg>; on a long
  // post with several code blocks that's a few KB of duplicated path
  // data in the HTML payload. The icon is now a CSS mask on
  // .notion-code__copy-button::before (see notion-blocks.css), so the
  // payload here drops to one element with a screen-reader label.
  return (
    <div className="notion-code no-wrap mdx-code">
      <button type="button" className="notion-code__copy-button">
        <span className="notion-code__copy-button-icon" aria-hidden="true" />
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
  span: MdxSpan,
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
