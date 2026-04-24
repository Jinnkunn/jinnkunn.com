import "server-only";

import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/** Render trusted markdown to a React tree via a pure AST pipeline
 * (remark → rehype → jsx-runtime). Unlike `@mdx-js/mdx`'s `evaluate()`,
 * this path never calls `new Function()`, so it runs on Cloudflare
 * Workers under the default runtime (no `unsafe_eval` binding needed).
 *
 * Meant for short, trusted markdown blocks that don't need MDX
 * components — home intro/body, structured-editor rich text, etc.
 * Full-MDX posts keep using `compilePostMdx` in `./compile.ts`. */
export async function renderSimpleMarkdown(
  source: string,
): Promise<ReactElement | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype);

  const mdast = processor.parse(trimmed);
  const hast = await processor.run(mdast);

  return toJsxRuntime(hast as Parameters<typeof toJsxRuntime>[0], {
    Fragment: jsxRuntime.Fragment,
    jsx: jsxRuntime.jsx,
    jsxs: jsxRuntime.jsxs,
  });
}
