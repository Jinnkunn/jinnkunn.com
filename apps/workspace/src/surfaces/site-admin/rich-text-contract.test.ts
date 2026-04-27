// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";

import {
  INLINE_MARKDOWN_PARSE_OPTIONS,
  inlineMarkdownToHtml,
  tiptapDocToMarkdown,
} from "./markdown-inline";
import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";
import { createRichTextExtensions } from "./rich-text-extensions";

function roundTripThroughTipTap(markdown: string): string {
  const editor = new Editor({
    extensions: createRichTextExtensions(),
    content: inlineMarkdownToHtml(markdown),
    parseOptions: INLINE_MARKDOWN_PARSE_OPTIONS,
  });
  try {
    return tiptapDocToMarkdown(editor.getJSON());
  } finally {
    editor.destroy();
  }
}

function roundTripThroughMdx(markdown: string): string {
  return serializeMdxBlocks(parseMdxBlocks(markdown));
}

describe("rich text core contract", () => {
  const cases: Array<{ name: string; markdown: string; expected?: string }> = [
    {
      name: "plain spaces stay visible around bold",
      markdown: "on **Explainable AI**, and **Visualization**",
    },
    {
      name: "legacy gray span trailing spaces move outside the mark",
      markdown:
        '<span data-color="gray">focuses on </span>**Explainable AI**<span data-color="gray">, and </span>**Visualization**',
      expected:
        '<span data-color="gray">focuses on</span> **Explainable AI**<span data-color="gray">, and</span> **Visualization**',
    },
    {
      name: "gray text and bold text preserve their boundary spaces",
      markdown:
        '<span data-color="gray">research primarily focuses on</span> **Explainable AI**, <span data-color="gray">and</span> **Visualization**',
    },
    {
      name: "regular link with bold label",
      markdown: "**[Tsinghua University](https://www.tsinghua.edu.cn/)**",
    },
    {
      name: "bold run containing a link",
      markdown:
        "**a co-founder of [Exorcat Technologies Ltd.](https://exorcat.com/)**",
    },
    {
      name: "icon link",
      markdown: '<span data-link-style="icon">[blog](/blog)</span>',
    },
    {
      name: "custom icon link",
      markdown:
        '<span data-link-style="icon" data-link-icon="https://cdn.example/icon.svg">[Archive](/teaching/archive)</span>',
    },
    {
      name: "gray bold icon link",
      markdown:
        '<span data-color="gray">also follow me on</span> **<span data-link-style="icon">[@_jinnkunn](https://twitter.com/_jinnkunn)</span>**',
    },
    {
      name: "line breaks",
      markdown: "2024/2025 Fall\nFaculty of Computer Science",
    },
    {
      name: "inline code protects literal span syntax",
      markdown: '`<span data-color="gray"> x </span>` and **bold**',
    },
    {
      name: "URL underscores do not become italic",
      markdown:
        '<span data-link-style="icon">[@_jinnkunn](https://twitter.com/_jinnkunn)</span>',
    },
  ];

  for (const item of cases) {
    it(`round-trips ${item.name} through TipTap`, () => {
      expect(roundTripThroughTipTap(item.markdown)).toBe(item.expected ?? item.markdown);
    });
  }

  it("keeps the TipTap output as valid MDX block text", () => {
    const markdown =
      '<span data-color="gray">focuses on </span>**Explainable AI** and <span data-link-style="icon">[blog](/blog)</span>';
    const tiptapMarkdown = roundTripThroughTipTap(markdown);
    expect(roundTripThroughMdx(tiptapMarkdown).trimEnd()).toBe(
      '<span data-color="gray">focuses on</span> **Explainable AI** and <span data-link-style="icon">[blog](/blog)</span>',
    );
  });
});
