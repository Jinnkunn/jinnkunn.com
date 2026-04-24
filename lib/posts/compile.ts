import "server-only";

import type { ReactElement } from "react";
import { evaluate, type EvaluateOptions } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { MDXComponents } from "mdx/types";

// Runtime MDX compile. We evaluate MDX each render so Tauri-driven edits land
// without a rebuild. Posts are force-static so the work happens once per
// deploy, plus on-demand in dev.
export async function compilePostMdx(source: string): Promise<{
  Content: (props: { components?: MDXComponents }) => ReactElement;
}> {
  const options: EvaluateOptions = {
    ...runtime,
    // remark-frontmatter MUST run before any rendering plugin so the
    // `---` YAML block becomes a dedicated frontmatter AST node instead
    // of getting parsed as content. Without it, a frontmatter block
    // whose last pre-`---` line is plain text (no tags list, no blank
    // line) is interpreted as a setext H2 — we were leaking the whole
    // frontmatter into the rendered HTML.
    remarkPlugins: [[remarkFrontmatter, ["yaml"]], remarkGfm, remarkMath],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "wrap",
          properties: {
            className: "notion-heading__anchor-link",
            ariaHidden: "true",
            tabIndex: -1,
          },
        },
      ],
      [rehypeKatex, { strict: false, throwOnError: false }],
    ],
    development: false,
  };
  const mod = (await evaluate(source, options)) as unknown as {
    default: (props: { components?: MDXComponents }) => ReactElement;
  };
  return {
    Content: mod.default,
  };
}
