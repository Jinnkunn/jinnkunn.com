import type { AnchorHTMLAttributes } from "react";
import type { MDXComponents } from "mdx/types";

import { ClassicLink } from "@/components/classic/classic-link";
import { Callout } from "./callout";
import { Embed } from "./embed";
import { Figure } from "./figure";
import { Toggle } from "./toggle";

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

// Components exposed to MDX. Native HTML elements (h1-6, p, code, pre,
// blockquote, ul, ol, img, hr, table…) are NOT overridden — they render as
// plain HTML and inherit the existing Notion/classic CSS since every post is
// rendered inside a `.notion-root` container.
export const postMdxComponents: MDXComponents = {
  a: MdxLink,
  Callout,
  Embed,
  Figure,
  Toggle,
};
