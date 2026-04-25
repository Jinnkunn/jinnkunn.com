import { describe, expect, it } from "vitest";

import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";

describe("mdx block editing model", () => {
  it("round-trips common page blocks", () => {
    const source = `# Title

Paragraph with **bold** text.

![Portrait](/uploads/me.png)

> A quote
> over two lines

\`\`\`ts
const value = 1;
\`\`\`
`;
    const blocks = parseMdxBlocks(source);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "quote",
      "code",
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("keeps an editable empty paragraph for blank documents", () => {
    const blocks = parseMdxBlocks("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(serializeMdxBlocks(blocks)).toBe("");
  });

  it("preserves blank lines inside fenced code blocks", () => {
    const source = "```js\nconst a = 1;\n\nconst b = 2;\n```\n";
    expect(serializeMdxBlocks(parseMdxBlocks(source))).toBe(source);
  });
});
