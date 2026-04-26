import "server-only";

import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function mergeClassName(value: unknown, classNames: string[]): string[] {
  const existing = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return Array.from(new Set([...existing, ...classNames].filter(Boolean)));
}

function decorateMarkdownHast(node: HastNode): void {
  if (node.type === "element" && node.tagName === "a") {
    const properties = node.properties ?? {};
    const href = typeof properties.href === "string" ? properties.href : "";
    properties.className = mergeClassName(properties.className, [
      "notion-link",
      "link",
    ]);
    if (/^https?:\/\//.test(href)) {
      properties.target = "_blank";
      properties.rel = "noopener noreferrer";
    }
    node.properties = properties;
  }

  for (const child of node.children ?? []) {
    decorateMarkdownHast(child);
  }
}

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
  const hast = (await processor.run(mdast)) as HastNode;
  decorateMarkdownHast(hast);

  return toJsxRuntime(hast as Parameters<typeof toJsxRuntime>[0], {
    Fragment: jsxRuntime.Fragment,
    jsx: jsxRuntime.jsx,
    jsxs: jsxRuntime.jsxs,
  });
}
