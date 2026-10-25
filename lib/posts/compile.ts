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
import { collectPostHeadings, type PostHeading } from "./outline";

// Runtime MDX compile. We evaluate MDX during server render so Site Admin edits
// stored in D1 can land without a full site rebuild.
export async function compilePostMdx(source: string): Promise<{
  Content: (props: { components?: MDXComponents }) => ReactElement;
  headings: PostHeading[];
}> {
  let headings: PostHeading[] = [];
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
      () => (tree) => { headings = collectPostHeadings(tree); },
      [
        rehypeAutolinkHeadings,
        {
          behavior: "wrap",
          properties: {
            className: "notion-heading__anchor-link",
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
    headings,
  };
}
