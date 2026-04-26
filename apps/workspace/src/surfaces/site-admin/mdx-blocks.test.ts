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

describe("columns blocks", () => {
  it("round-trips a default 2-column block with one paragraph each", () => {
    const source =
      '<Columns count={2}>\n<Column>\n\nLeft side.\n\n</Column>\n<Column>\n\nRight side.\n\n</Column>\n</Columns>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("columns");
    expect(blocks[0].columns).toBe(2);
    expect(blocks[0].children).toHaveLength(2);
    expect(blocks[0].children?.[0].type).toBe("column");
    expect(blocks[0].children?.[0].children?.[0].text).toBe("Left side.");
    expect(blocks[0].children?.[1].children?.[0].text).toBe("Right side.");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips a 3-column block with gap, align, and variant attrs", () => {
    const source =
      '<Columns count={3} variant="classicIntro" gap="loose" align="center">\n<Column>\n\nA\n\n</Column>\n<Column>\n\nB\n\n</Column>\n<Column>\n\nC\n\n</Column>\n</Columns>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].columns).toBe(3);
    expect(blocks[0].columnsGap).toBe("loose");
    expect(blocks[0].columnsAlign).toBe("center");
    expect(blocks[0].columnsVariant).toBe("classicIntro");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("supports nested headings and lists inside a column", () => {
    const source =
      '<Columns count={2}>\n<Column>\n\n## Heading\n\n- one\n- two\n\n</Column>\n<Column>\n\nPlain text.\n\n</Column>\n</Columns>\n';
    const blocks = parseMdxBlocks(source);
    const left = blocks[0].children?.[0].children ?? [];
    expect(left[0].type).toBe("heading");
    expect(left[1].type).toBe("list");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("clamps a stray count={1} up to 2 and pads the missing column", () => {
    const source = '<Columns count={1}>\n<Column>\n\nOnly one.\n\n</Column>\n</Columns>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].columns).toBe(2);
    expect(blocks[0].children).toHaveLength(2);
  });

  it("ignores unknown gap/align values rather than crashing", () => {
    const source =
      '<Columns count={2} gap="bogus" align="weird">\n<Column>\n\nA\n\n</Column>\n<Column>\n\nB\n\n</Column>\n</Columns>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].columnsGap).toBeUndefined();
    expect(blocks[0].columnsAlign).toBeUndefined();
  });

  it("falls back to raw when Columns is unclosed", () => {
    const source = "<Columns count={2}>\n<Column>\n\nA\n\n</Column>\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("raw");
  });
});

describe("news-entry blocks", () => {
  it("round-trips a news entry with a date and a single paragraph", () => {
    const source =
      '<NewsEntry date="2026-04-15">\n\nWe shipped the editor.\n\n</NewsEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("news-entry");
    expect(blocks[0].dateIso).toBe("2026-04-15");
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children?.[0].type).toBe("paragraph");
    expect(blocks[0].children?.[0].text).toBe("We shipped the editor.");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("supports headings, lists, and callouts inside the entry body", () => {
    const source =
      '<NewsEntry date="2026-03-20">\n\n## Spring update\n\n- Item one\n- Item two\n\n> [!NOTE]\n> Heads-up note.\n\n</NewsEntry>\n';
    const blocks = parseMdxBlocks(source);
    const body = blocks[0].children ?? [];
    expect(body[0].type).toBe("heading");
    expect(body[1].type).toBe("list");
    expect(body[2].type).toBe("callout");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("preserves an empty entry as `<NewsEntry date=\"...\"></NewsEntry>` adjacent lines", () => {
    const source = '<NewsEntry date="2026-04-01">\n</NewsEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].children).toHaveLength(0);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("rejects malformed dates (keeps dateIso empty so the editor warns)", () => {
    const source = '<NewsEntry date="2026/04/15">\n\nWords.\n\n</NewsEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].dateIso).toBe("");
  });

  it("falls back to raw when NewsEntry is unclosed", () => {
    const source = '<NewsEntry date="2026-04-15">\n\nWords.\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("raw");
  });
});

describe("works-entry blocks", () => {
  it("round-trips a recent entry with role + period + body", () => {
    const source =
      '<WorksEntry category="recent" role="Intern" period="Nov 2025 - Now">\n\nA short description.\n\n</WorksEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("works-entry");
    expect(blocks[0].worksCategory).toBe("recent");
    expect(blocks[0].worksRole).toBe("Intern");
    expect(blocks[0].worksPeriod).toBe("Nov 2025 - Now");
    expect(blocks[0].children?.[0].text).toBe("A short description.");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips affiliation, affiliationUrl, and location attrs", () => {
    const source =
      '<WorksEntry category="passed" role="Research Assistant" affiliation="Dalhousie" affiliationUrl="https://dal.ca" location="Halifax, NS" period="Feb 2021 - Mar 2023">\n\nDetails.\n\n</WorksEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].worksAffiliation).toBe("Dalhousie");
    expect(blocks[0].worksAffiliationUrl).toBe("https://dal.ca");
    expect(blocks[0].worksLocation).toBe("Halifax, NS");
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("defaults category to recent when missing or unknown", () => {
    const source =
      '<WorksEntry role="X" period="2024 - Now">\n\nBody.\n\n</WorksEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].worksCategory).toBe("recent");
  });

  it("supports an empty body (header-only entry)", () => {
    const source =
      '<WorksEntry category="recent" role="X" period="2024 - Now">\n</WorksEntry>\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].children).toHaveLength(0);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("falls back to raw when WorksEntry is unclosed", () => {
    const source = '<WorksEntry role="X" period="2024">\n\nBody.\n';
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("raw");
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

describe("link-list block (inline-config with item array)", () => {
  it("round-trips a LinkListBlock with title + grid layout + items", () => {
    const source =
      `<LinkListBlock title="Find me" layout="grid" items='[{"label":"GitHub","href":"https://github.com/x"},{"label":"Email","href":"mailto:x@example.com"}]' />\n`;
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("link-list-block");
    expect(blocks[0].title).toBe("Find me");
    expect(blocks[0].linkLayout).toBe("grid");
    expect(blocks[0].linkItems).toEqual([
      { label: "GitHub", href: "https://github.com/x" },
      { label: "Email", href: "mailto:x@example.com" },
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("omits empty items + default stack layout on serialize", () => {
    const source = "<LinkListBlock />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].linkLayout).toBe("stack");
    expect(blocks[0].linkItems).toEqual([]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("silently drops malformed items in the JSON attribute", () => {
    // First entry is missing href; second is the wrong type entirely.
    // The parser should keep what it can recover (here: nothing usable).
    const source = `<LinkListBlock items='[{"label":"x"},42,"bad"]' />\n`;
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].type).toBe("link-list-block");
    // The first entry has a label but no href — `parseLinkItems` keeps
    // it because at least one of label/href is present.
    expect(blocks[0].linkItems).toEqual([{ label: "x", href: "" }]);
  });

  it("preserves description on items that have it", () => {
    const source =
      `<LinkListBlock items='[{"label":"X","href":"/x","description":"A note"}]' />\n`;
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].linkItems).toEqual([
      { label: "X", href: "/x", description: "A note" },
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("round-trips an apostrophe in an item value via \\u0027 escape", () => {
    // The block sits inside a single-quoted JSX attribute, so any raw
    // `'` in a value would terminate the attr early. jsonAttr escapes
    // them as JSON unicode escapes; JSON.parse turns them back into
    // real apostrophes on read.
    const blocks = [
      {
        id: "test",
        type: "link-list-block" as const,
        text: "",
        linkItems: [{ label: "Don't", href: "/x" }],
      },
    ];
    const md = serializeMdxBlocks(blocks);
    expect(md).not.toMatch(/'Don't'/);
    expect(md).toMatch(/Don\\u0027t/);
    const reparsed = parseMdxBlocks(md);
    expect(reparsed[0].linkItems).toEqual([{ label: "Don't", href: "/x" }]);
  });
});

describe("featured-pages block", () => {
  it("round-trips a FeaturedPagesBlock with title + columns + cards", () => {
    const source =
      `<FeaturedPagesBlock title="Highlights" columns={3} items='[{"label":"Posts","href":"/posts","description":"Thoughts and notes"},{"label":"Works","href":"/works"}]' />\n`;
    const blocks = parseMdxBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("featured-pages-block");
    expect(blocks[0].title).toBe("Highlights");
    expect(blocks[0].columns).toBe(3);
    expect(blocks[0].linkItems).toEqual([
      { label: "Posts", href: "/posts", description: "Thoughts and notes" },
      { label: "Works", href: "/works" },
    ]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("omits default columns=2 + empty items on serialize", () => {
    const source = "<FeaturedPagesBlock />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].columns).toBe(2);
    expect(blocks[0].linkItems).toEqual([]);
    expect(serializeMdxBlocks(blocks)).toBe(source);
  });

  it("clamps unknown columns values to default 2", () => {
    const source = "<FeaturedPagesBlock columns={42} />\n";
    const blocks = parseMdxBlocks(source);
    expect(blocks[0].columns).toBe(2);
  });
});
