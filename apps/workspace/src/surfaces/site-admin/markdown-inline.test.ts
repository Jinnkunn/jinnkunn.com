import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";

import { inlineMarkdownToHtml, tiptapDocToMarkdown } from "./markdown-inline";

// Mimic the JSON shape TipTap emits via editor.getJSON() so we can assert
// round-trip behaviour without instantiating a real editor in the test.
function makeText(
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[],
): JSONContent {
  return marks?.length ? { type: "text", text, marks } : { type: "text", text };
}

function makeDoc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

describe("inlineMarkdownToHtml", () => {
  it("wraps plain text in a single paragraph", () => {
    expect(inlineMarkdownToHtml("hello")).toBe("<p>hello</p>");
  });

  it("converts bold + italic + code + strike + link", () => {
    expect(inlineMarkdownToHtml("**foo** *bar* `baz` ~~qux~~ [text](https://x)"))
      .toBe('<p><strong>foo</strong> <em>bar</em> <code>baz</code> <s>qux</s> <a href="https://x">text</a></p>');
  });

  it("preserves <u> tags so the Underline mark round-trips", () => {
    expect(inlineMarkdownToHtml("normal <u>under</u>")).toBe("<p>normal <u>under</u></p>");
    expect(inlineMarkdownToHtml("<u>**bold + under**</u>"))
      .toBe("<p><u><strong>bold + under</strong></u></p>");
  });

  it("preserves <span data-color> so the inline color mark round-trips", () => {
    expect(
      inlineMarkdownToHtml('plain <span data-color="red">red</span> tail'),
    ).toBe('<p>plain <span data-color="red">red</span> tail</p>');
    expect(
      inlineMarkdownToHtml(
        '<span data-color="blue" data-bg="yellow">**bold + colored**</span>',
      ),
    ).toBe(
      '<p><span data-color="blue" data-bg="yellow"><strong>bold + colored</strong></span></p>',
    );
  });

  it("preserves <span data-link-style> so icon links round-trip", () => {
    expect(
      inlineMarkdownToHtml(
        '<span data-link-style="icon">[Archive](/teaching/archive)</span>',
      ),
    ).toBe(
      '<p><span data-link-style="icon"><a href="/teaching/archive">Archive</a></span></p>',
    );
  });

  it("preserves custom icon URLs on icon links", () => {
    expect(
      inlineMarkdownToHtml(
        '<span data-link-style="icon" data-link-icon="https://cdn.example/icon.svg">[Archive](/teaching/archive)</span>',
      ),
    ).toBe(
      '<p><span data-link-style="icon" data-link-icon="https://cdn.example/icon.svg"><a href="/teaching/archive">Archive</a></span></p>',
    );
  });

  it("does not treat underscores inside links as italic delimiters", () => {
    expect(
      inlineMarkdownToHtml(
        '<span data-link-style="icon">[@_jinnkunn](https://twitter.com/_jinnkunn)</span>',
      ),
    ).toBe(
      '<p><span data-link-style="icon"><a href="https://twitter.com/_jinnkunn">@_jinnkunn</a></span></p>',
    );
  });

  it("keeps visible spaces between colored text and bold text", () => {
    expect(
      inlineMarkdownToHtml(
        '<span data-color="gray">focuses on</span> **Explainable AI**<span data-color="gray">, and</span> **Visualization**',
      ),
    ).toBe(
      '<p><span data-color="gray">focuses on</span> <strong>Explainable AI</strong><span data-color="gray">, and</span> <strong>Visualization</strong></p>',
    );
  });

  it("keeps bold link labels inside the link instead of leaking markdown stars", () => {
    expect(
      inlineMarkdownToHtml("**a co-founder of [Exorcat Technologies Ltd.](https://exorcat.com/)**"),
    ).toBe(
      '<p><strong>a co-founder of <a href="https://exorcat.com/">Exorcat Technologies Ltd.</a></strong></p>',
    );
  });

  it("preserves underscores in mid-word identifiers (no italic)", () => {
    expect(inlineMarkdownToHtml("foo_bar_baz")).toBe("<p>foo_bar_baz</p>");
  });

  it("does not interpret markdown chars inside inline code", () => {
    expect(inlineMarkdownToHtml("`**not bold**`")).toBe("<p><code>**not bold**</code></p>");
  });

  it("html-escapes user-typed angle brackets", () => {
    expect(inlineMarkdownToHtml("a < b > c")).toBe("<p>a &lt; b &gt; c</p>");
  });

  it("converts newlines to <br>", () => {
    expect(inlineMarkdownToHtml("line one\nline two")).toBe("<p>line one<br>line two</p>");
  });

  it("returns an empty paragraph for empty input", () => {
    expect(inlineMarkdownToHtml("")).toBe("<p></p>");
  });
});

describe("tiptapDocToMarkdown", () => {
  it("emits plain text unchanged", () => {
    expect(tiptapDocToMarkdown(makeDoc(makeText("hello")))).toBe("hello");
  });

  it("wraps a bold mark with **", () => {
    const doc = makeDoc(makeText("foo", [{ type: "bold" }]));
    expect(tiptapDocToMarkdown(doc)).toBe("**foo**");
  });

  it("emits link with [label](href)", () => {
    const doc = makeDoc(makeText("text", [{ type: "link", attrs: { href: "https://x" } }]));
    expect(tiptapDocToMarkdown(doc)).toBe("[text](https://x)");
  });

  it("serializes custom icon URLs on icon links", () => {
    const doc = makeDoc(makeText("Archive", [
      { type: "link", attrs: { href: "/teaching/archive" } },
      {
        type: "inlineLinkStyle",
        attrs: { style: "icon", icon: "https://cdn.example/icon.svg" },
      },
    ]));
    expect(tiptapDocToMarkdown(doc)).toBe(
      '<span data-link-style="icon" data-link-icon="https://cdn.example/icon.svg">[Archive](/teaching/archive)</span>',
    );
  });

  it("groups bold outside a bold link to avoid split markdown delimiters", () => {
    const doc = makeDoc(
      makeText("bold", [
        { type: "bold" },
        { type: "link", attrs: { href: "/y" } },
      ]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe("**[bold](/y)**");
  });

  it("keeps a continuous bold run across adjacent text and links", () => {
    const doc = makeDoc(
      makeText("a co-founder of ", [{ type: "bold" }]),
      makeText("Exorcat Technologies Ltd.", [
        { type: "bold" },
        { type: "link", attrs: { href: "https://exorcat.com/" } },
      ]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe(
      "**a co-founder of [Exorcat Technologies Ltd.](https://exorcat.com/)**",
    );
  });

  it("serializes boundary spaces outside inline color and bold marks", () => {
    const doc = makeDoc(
      makeText("My research primarily focuses on ", [
        { type: "inlineColor", attrs: { color: "gray" } },
      ]),
      makeText("Explainable AI", [{ type: "bold" }]),
      makeText(", and ", [{ type: "inlineColor", attrs: { color: "gray" } }]),
      makeText("Visualization", [{ type: "bold" }]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe(
      '<span data-color="gray">My research primarily focuses on</span> **Explainable AI**<span data-color="gray">, and</span> **Visualization**',
    );
  });

  it("serializes leading spaces outside bold marks", () => {
    const doc = makeDoc(
      makeText("focuses on", [{ type: "inlineColor", attrs: { color: "gray" } }]),
      makeText(" Explainable AI", [{ type: "bold" }]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe(
      '<span data-color="gray">focuses on</span> **Explainable AI**',
    );
  });

  it("hardBreak becomes a newline", () => {
    const doc = makeDoc(
      makeText("a"),
      { type: "hardBreak" },
      makeText("b"),
    );
    expect(tiptapDocToMarkdown(doc)).toBe("a\nb");
  });

  it("code wraps innermost so bold + code prints **`x`**", () => {
    const doc = makeDoc(makeText("x", [{ type: "code" }, { type: "bold" }]));
    expect(tiptapDocToMarkdown(doc)).toBe("**`x`**");
  });

  it("underline wraps in <u>...</u> outside the markdown-char marks", () => {
    const doc = makeDoc(makeText("y", [{ type: "underline" }, { type: "bold" }]));
    expect(tiptapDocToMarkdown(doc)).toBe("<u>**y**</u>");
  });

  it("inline color emits <span> with whichever data-* attrs are set", () => {
    expect(
      tiptapDocToMarkdown(
        makeDoc(makeText("hot", [{ type: "inlineColor", attrs: { color: "red" } }])),
      ),
    ).toBe('<span data-color="red">hot</span>');
    expect(
      tiptapDocToMarkdown(
        makeDoc(makeText("hl", [{ type: "inlineColor", attrs: { bg: "yellow" } }])),
      ),
    ).toBe('<span data-bg="yellow">hl</span>');
    expect(
      tiptapDocToMarkdown(
        makeDoc(
          makeText("both", [
            { type: "inlineColor", attrs: { color: "blue", bg: "gray" } },
          ]),
        ),
      ),
    ).toBe('<span data-color="blue" data-bg="gray">both</span>');
  });

  it("inline color skips emitting when both attrs are null/empty", () => {
    expect(
      tiptapDocToMarkdown(
        makeDoc(
          makeText("plain", [
            { type: "inlineColor", attrs: { color: null, bg: null } },
          ]),
        ),
      ),
    ).toBe("plain");
  });

  it("wraps icon-link presentation outside the markdown link", () => {
    const doc = makeDoc(
      makeText("Archive", [
        { type: "inlineLinkStyle", attrs: { style: "icon" } },
        { type: "link", attrs: { href: "/teaching/archive" } },
      ]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe(
      '<span data-link-style="icon">[Archive](/teaching/archive)</span>',
    );
  });

  it("preserves bold on icon links", () => {
    const doc = makeDoc(
      makeText("Blog", [
        { type: "bold" },
        { type: "inlineLinkStyle", attrs: { style: "icon" } },
        { type: "link", attrs: { href: "/blog" } },
      ]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe(
      '**<span data-link-style="icon">[Blog](/blog)</span>**',
    );
    expect(
      inlineMarkdownToHtml('**<span data-link-style="icon">[Blog](/blog)</span>**'),
    ).toBe('<p><strong><span data-link-style="icon"><a href="/blog">Blog</a></span></strong></p>');
  });
});

// Round-trip: markdown -> html -> (parsed by TipTap, but we can sketch the
// expected JSON) -> markdown. Since we don't run TipTap here, we assert the
// simpler property: the HTML output is what TipTap would produce JSON for.
// Full round-trip is exercised by the integration test in the dev runtime.
describe("round-trip basics", () => {
  it("doc->markdown of bold+italic mirrors the input mark order", () => {
    const doc = makeDoc(makeText("y", [{ type: "italic" }, { type: "bold" }]));
    expect(tiptapDocToMarkdown(doc)).toBe("***y***");
  });
});
