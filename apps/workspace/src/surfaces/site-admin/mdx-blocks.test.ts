import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";

function splitFrontmatter(source: string): string {
  const match = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/m.exec(source);
  return match ? match[1] : source;
}

function contentFixturePaths(): string[] {
  const root = path.resolve(process.cwd(), "../..");
  return ["content/posts", "content/pages"].flatMap((dir) => {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) return [];
    return fs
      .readdirSync(absDir)
      .filter((filename) => filename.endsWith(".mdx") || filename.endsWith(".md"))
      .map((filename) => path.join(absDir, filename));
  });
}

describe("mdx block editing model", () => {
  it("round-trips common page blocks", () => {
    const source = `# Title

Paragraph with **bold** text.

![Portrait](/uploads/me.png)

---

- one
- two

> [!NOTE]
> A callout

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
      "divider",
      "list",
      "callout",
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

  it("round-trips current page and post content bodies", () => {
    const fixtures = contentFixturePaths();
    expect(fixtures.length).toBeGreaterThan(0);
    for (const filePath of fixtures) {
      const body = splitFrontmatter(fs.readFileSync(filePath, "utf8")).trimStart();
      const expected = body.trim() ? (body.endsWith("\n") ? body : `${body}\n`) : "";
      expect(serializeMdxBlocks(parseMdxBlocks(body)), path.basename(filePath)).toBe(
        expected,
      );
    }
  });
});
