import type { MDXComponents } from "mdx/types";

import { Callout } from "./callout";
import { Embed } from "./embed";
import { Figure } from "./figure";
import { Toggle } from "./toggle";

// Components exposed to MDX. Native HTML elements (h1-6, p, code, pre,
// blockquote, ul, ol, img, hr, table…) are NOT overridden — they render as
// plain HTML and inherit the existing Notion/classic CSS since every post is
// rendered inside a `.notion-root` container.
export const postMdxComponents: MDXComponents = {
  Callout,
  Embed,
  Figure,
  Toggle,
};
