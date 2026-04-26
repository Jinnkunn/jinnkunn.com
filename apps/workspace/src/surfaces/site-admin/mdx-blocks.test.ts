import { describe, expect, it } from "vitest";

import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";

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
});

describe("todo blocks", () => {
  it("round-trips a mixed checked / unchecked list", () => {
    const source = "- [ ] write tests\n- [x] ship feature\n- [ ] update docs\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("todo");
    expect(blocks[0].text).toBe("write tests\nship feature\nupdate docs");
    expect(blocks[0].checkedLines).toEqual([1]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("treats todo before bullet list when both could match", () => {
    const blocks = parseMdxBlocks("- [ ] thing\n");
    expect(blocks[0].type).toBe("todo");
  });
});

describe("toggle blocks", () => {
  it("round-trips a basic open toggle with one inner paragraph", () => {
    const source =
      "<details open>\n<summary>FAQ</summary>\n\nInner content here.\n\n</details>\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("toggle");
    expect(blocks[0].text).toBe("FAQ");
    expect(blocks[0].open).toBe(true);
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children?.[0].type).toBe("paragraph");
    expect(blocks[0].children?.[0].text).toBe("Inner content here.");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("supports collapsed toggles with multiple child blocks", () => {
    const source =
      "<details>\n<summary>Mix</summary>\n\n## Heading\n\n- [ ] a todo\n\n</details>\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("toggle");
    expect(blocks[0].open).toBe(false);
    expect(blocks[0].children?.[0].type).toBe("heading");
    expect(blocks[0].children?.[1].type).toBe("todo");
  });

  it("falls back to raw when nested toggles are detected", () => {
    // The outer parser at depth 0 captures the entire <details> block, then
    // descends. The inner parser at depth 1 will not recognize <details> as a
    // toggle and falls through to raw, leaving the nested HTML as a single
    // raw child block.
    const source =
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nbody\n\n</details>\n\n</details>\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("toggle");
    expect(blocks[0].children?.[0].type).toBe("raw");
  });

  it("renders empty toggle without extra blank lines", () => {
    const source = "<details>\n<summary>Empty</summary>\n</details>\n";
    expect(serializeMdxBlocks(parseMdxBlocks(source))).toBe(source);
  });
});

describe("table blocks", () => {
  it("round-trips a 2x2 table with column alignment", () => {
    const source =
      "| h1 | h2 |\n| --- | :---: |\n| a | b |\n| c | d |\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("table");
    expect(blocks[0].tableData?.rows).toEqual([
      ["h1", "h2"],
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(blocks[0].tableData?.align).toEqual(["left", "center"]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("pads short rows to the header width", () => {
    const source = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].tableData?.rows[1]).toEqual(["1", "2", ""]);
  });
});

describe("self-closing JSX blocks", () => {
  it("round-trips a Bookmark", () => {
    const source =
      '<Bookmark url="https://example.com" title="Example" description="A site" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("bookmark");
    expect(blocks[0].url).toBe("https://example.com");
    expect(blocks[0].title).toBe("Example");
    expect(blocks[0].description).toBe("A site");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a YouTube video tag", () => {
    const source = '<Video kind="youtube" url="https://youtu.be/abc" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("embed");
    expect(blocks[0].embedKind).toBe("youtube");
    expect(blocks[0].url).toBe("https://youtu.be/abc");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips an Embed (generic iframe)", () => {
    const source =
      '<Embed src="https://codepen.io/x/embed" title="Demo" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("embed");
    expect(blocks[0].embedKind).toBe("iframe");
    expect(blocks[0].url).toBe("https://codepen.io/x/embed");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a FileLink with size attr", () => {
    const source = '<FileLink href="/uploads/x.pdf" filename="x.pdf" size={1024} />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("file");
    expect(blocks[0].url).toBe("/uploads/x.pdf");
    expect(blocks[0].filename).toBe("x.pdf");
    expect(blocks[0].size).toBe(1024);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a PageLink", () => {
    const source = '<PageLink slug="about" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("page-link");
    expect(blocks[0].pageSlug).toBe("about");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });
});

describe("block color wrappers", () => {
  it("round-trips a colored paragraph", () => {
    const source = '<Color bg="yellow">\n\nHighlighted text.\n\n</Color>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].color).toBe("yellow");
    expect(blocks[0].text).toBe("Highlighted text.");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a colored heading", () => {
    const source = '<Color bg="blue">\n\n# Section\n\n</Color>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].color).toBe("blue");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("emits no wrapper when color is default or unset", () => {
    const source = "Plain.\n";
    const blocks = parseMdxBlocks(source);
    blocks[0].color = "default";
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });
});

describe("data-source blocks", () => {
  it("round-trips a NewsBlock without limit", () => {
    const source = "<NewsBlock />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("news-block");
    expect(blocks[0].limit).toBeUndefined();
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a NewsBlock with limit", () => {
    const source = "<NewsBlock limit={5} />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("news-block");
    expect(blocks[0].limit).toBe(5);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("ignores invalid limit values during parse", () => {
    // Numeric attributes use {N} braces; a quoted string is not a valid
    // number per our parser, so the block falls back to "no cap".
    const source = '<NewsBlock limit="bad" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("news-block");
    expect(blocks[0].limit).toBeUndefined();
  });

  it("coexists with surrounding paragraphs", () => {
    const source = "Intro paragraph.\n\n<NewsBlock limit={3} />\n\nOutro line.\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "news-block",
      "paragraph",
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a PublicationsBlock without limit", () => {
    const source = "<PublicationsBlock />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("publications-block");
    expect(blocks[0].limit).toBeUndefined();
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a PublicationsBlock with limit", () => {
    const source = "<PublicationsBlock limit={10} />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("publications-block");
    expect(blocks[0].limit).toBe(10);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("mixes news + publications + paragraphs in one document", () => {
    const source =
      "# Hello\n\n<NewsBlock limit={3} />\n\nThen some prose.\n\n<PublicationsBlock />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "news-block",
      "paragraph",
      "publications-block",
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a WorksBlock with and without limit", () => {
    for (const source of ["<WorksBlock />\n", "<WorksBlock limit={5} />\n"]) {
      const blocks = parseMdxBlocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("works-block");
      expect(serializeMdxBlocks(blocks)).toBe(source);
    }
  });

  it("round-trips a TeachingBlock with and without limit", () => {
    for (const source of [
      "<TeachingBlock />\n",
      "<TeachingBlock limit={4} />\n",
    ]) {
      const blocks = parseMdxBlocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("teaching-block");
      expect(serializeMdxBlocks(blocks)).toBe(source);
    }
  });
});

describe("hero block (inline-config)", () => {
  it("round-trips a HeroBlock with title + image + custom layout", () => {
    const source =
      '<HeroBlock title="Hi" subtitle="welcome" imageUrl="/uploads/me.jpg" imageAlt="Me" imagePosition="left" textAlign="center" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("hero-block");
    expect(blocks[0].title).toBe("Hi");
    expect(blocks[0].subtitle).toBe("welcome");
    expect(blocks[0].url).toBe("/uploads/me.jpg");
    expect(blocks[0].alt).toBe("Me");
    expect(blocks[0].imagePosition).toBe("left");
    expect(blocks[0].textAlign).toBe("center");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("omits default imagePosition (right) and textAlign (left) on serialize", () => {
    // Defaults are skipped to keep the serialized form short.
    const source = '<HeroBlock title="Hi" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].imagePosition).toBe("right"); // applied during parse
    expect(blocks[0].textAlign).toBe("left");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("falls back to defaults when imagePosition or textAlign is invalid", () => {
    const source = '<HeroBlock imagePosition="bogus" textAlign="weird" />\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].imagePosition).toBe("right");
    expect(blocks[0].textAlign).toBe("left");
  });
});
