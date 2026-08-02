import { describe, expect, it } from "vitest";

import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";

// Regression tests for round-trip data loss in the block editor:
// content that contains markdown structural characters must survive
// parse -> serialize -> parse without truncation or corruption.

describe("mdx-blocks round-trip escaping", () => {
  it("preserves a code block whose body contains a ``` line", () => {
    // A 4-backtick fence wraps a body that itself contains ``` lines.
    const source = "````\n```\ninner code\n```\n````";
    const blocks = parseMdxBlocks(source);
    const code = blocks.find((b) => b.type === "code");
    expect(code).toBeTruthy();
    expect(code?.text).toBe("```\ninner code\n```");

    // Serialize must escalate the fence past the inner ``` and re-parse cleanly.
    const round = parseMdxBlocks(serializeMdxBlocks(blocks));
    const roundCode = round.find((b) => b.type === "code");
    expect(roundCode?.text).toBe("```\ninner code\n```");
  });

  it("preserves a literal | typed into a table cell", () => {
    const source = "| a \\| b | c |\n| --- | --- |\n| d | e \\| f |";
    const blocks = parseMdxBlocks(source);
    const table = blocks.find((b) => b.type === "table");
    expect(table?.tableData?.rows?.[0]?.[0]).toBe("a | b");
    expect(table?.tableData?.rows?.[1]?.[1]).toBe("e | f");

    const round = parseMdxBlocks(serializeMdxBlocks(blocks));
    const roundTable = round.find((b) => b.type === "table");
    expect(roundTable?.tableData?.rows?.[0]?.[0]).toBe("a | b");
    expect(roundTable?.tableData?.rows?.[1]?.[1]).toBe("e | f");
  });

  it("serialized output is idempotent for pipe-bearing tables and nested fences", () => {
    const source = "````\n```\nx\n```\n````\n\n| a \\| b | c |\n| --- | --- |\n| 1 | 2 |";
    const once = serializeMdxBlocks(parseMdxBlocks(source));
    const twice = serializeMdxBlocks(parseMdxBlocks(once));
    expect(twice).toBe(once);
  });
});
