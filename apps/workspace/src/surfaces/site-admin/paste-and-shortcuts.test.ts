import { describe, expect, it } from "vitest";

import {
  blocksFromPlainTextPaste,
  markdownShortcutBlock,
  shouldPromotePlainTextPaste,
} from "./rich-text-editable-block";

// Pure-function coverage for the editor's two most-used promotion
// paths: typing a markdown marker at the start of a block (slash-style
// shortcut), and pasting a markdown blob from outside the editor. Both
// of these cross the "plain text → structured MdxBlock" boundary, so
// regressions here would silently downgrade the editor back to a
// textarea on the user's most-common authoring flow.

describe("rich-text: markdownShortcutBlock", () => {
  it("promotes # to a heading-1 with empty text", () => {
    const block = markdownShortcutBlock("# ");
    expect(block?.type).toBe("heading");
    expect(block && block.type === "heading" ? block.level : null).toBe(1);
    expect(block?.text).toBe("");
  });

  it("promotes ## to heading-2 and ### to heading-3", () => {
    expect(
      markdownShortcutBlock("##") &&
        markdownShortcutBlock("##")!.type === "heading"
        ? (markdownShortcutBlock("##")! as { level: number }).level
        : null,
    ).toBe(2);
    const h3 = markdownShortcutBlock("###");
    expect(h3?.type).toBe("heading");
    expect(h3 && h3.type === "heading" ? h3.level : null).toBe(3);
  });

  it("promotes - and * to bulleted list, digits+dot to numbered", () => {
    const dash = markdownShortcutBlock("-");
    expect(dash?.type).toBe("list");
    expect(dash && dash.type === "list" ? dash.listStyle : null).toBe("bulleted");
    const star = markdownShortcutBlock("*");
    expect(star?.type).toBe("list");
    expect(star && star.type === "list" ? star.listStyle : null).toBe("bulleted");
    const ordered = markdownShortcutBlock("1.");
    expect(ordered?.type).toBe("list");
    expect(ordered && ordered.type === "list" ? ordered.listStyle : null).toBe(
      "numbered",
    );
  });

  it("promotes > to a quote and ``` to a code block", () => {
    expect(markdownShortcutBlock(">")?.type).toBe("quote");
    expect(markdownShortcutBlock("```")?.type).toBe("code");
  });

  it("promotes [ ] to an unchecked todo and [x] to a checked todo", () => {
    expect(markdownShortcutBlock("[ ]")?.type).toBe("todo");
    expect(markdownShortcutBlock("[]")?.type).toBe("todo");
    const checked = markdownShortcutBlock("[x]");
    expect(checked?.type).toBe("todo");
    expect(checked && checked.type === "todo" ? checked.checkedLines : null)
      .toEqual([0]);
  });

  it("promotes --- and *** to a horizontal divider", () => {
    expect(markdownShortcutBlock("---")?.type).toBe("divider");
    expect(markdownShortcutBlock("***")?.type).toBe("divider");
  });

  it("rejects strings that don't match a known shortcut", () => {
    expect(markdownShortcutBlock("")).toBeNull();
    expect(markdownShortcutBlock("hello")).toBeNull();
    expect(markdownShortcutBlock("#hello")).toBeNull();
    expect(markdownShortcutBlock("####")).toBeNull();
  });
});

describe("rich-text: shouldPromotePlainTextPaste", () => {
  it("returns false for an empty paste", () => {
    expect(shouldPromotePlainTextPaste("")).toBe(false);
    expect(shouldPromotePlainTextPaste("   ")).toBe(false);
  });

  it("returns false for a single-paragraph plain string", () => {
    expect(shouldPromotePlainTextPaste("just a sentence")).toBe(false);
  });

  it("promotes when the paste has a blank-line gap", () => {
    expect(
      shouldPromotePlainTextPaste("first paragraph\n\nsecond paragraph"),
    ).toBe(true);
  });

  it("promotes a fenced code block start", () => {
    expect(shouldPromotePlainTextPaste("```ts\nconst x = 1;\n```")).toBe(true);
  });

  it("promotes markdown heading / list / quote / todo openers", () => {
    expect(shouldPromotePlainTextPaste("# Heading")).toBe(true);
    expect(shouldPromotePlainTextPaste("- one\n- two")).toBe(true);
    expect(shouldPromotePlainTextPaste("1. one\n2. two")).toBe(true);
    expect(shouldPromotePlainTextPaste("> a quote")).toBe(true);
    expect(shouldPromotePlainTextPaste("- [ ] todo line")).toBe(true);
  });

  it("promotes a markdown table (header + separator + row)", () => {
    const table =
      "| col1 | col2 |\n| :--- | ---: |\n| a    | b    |";
    expect(shouldPromotePlainTextPaste(table)).toBe(true);
  });

  it("does not promote two unrelated lines without separators", () => {
    expect(shouldPromotePlainTextPaste("line one\nline two")).toBe(false);
  });
});

describe("rich-text: blocksFromPlainTextPaste", () => {
  it("returns an empty array for an empty paste", () => {
    expect(blocksFromPlainTextPaste("")).toEqual([]);
  });

  it("filters out empty paragraphs that would create blank blocks", () => {
    // The paste promotion should never insert a runt empty paragraph.
    const blocks = blocksFromPlainTextPaste("hello\n\n\nworld");
    expect(blocks.every((block) => {
      if (block.type === "paragraph") return block.text.trim().length > 0;
      return true;
    })).toBe(true);
  });

  it("preserves a markdown heading and a paragraph as separate blocks", () => {
    const blocks = blocksFromPlainTextPaste("# Title\n\nBody copy.");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]?.type).toBe("heading");
    // Look at the LAST block — there can be intermediate spacers.
    expect(blocks[blocks.length - 1]?.type).toBe("paragraph");
  });
});
