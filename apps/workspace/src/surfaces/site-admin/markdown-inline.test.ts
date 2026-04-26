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

  it("nests bold inside link as outermost mark", () => {
    const doc = makeDoc(
      makeText("bold", [
        { type: "bold" },
        { type: "link", attrs: { href: "/y" } },
      ]),
    );
    expect(tiptapDocToMarkdown(doc)).toBe("[**bold**](/y)");
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
