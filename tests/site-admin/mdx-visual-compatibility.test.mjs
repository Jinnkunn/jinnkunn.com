import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeVisualMdxCompatibility,
  visualCompatibilitySummary,
} from "../../lib/site-admin/mdx-visual-compatibility.ts";

test("visual MDX compatibility accepts Markdown, GFM, math, and static component blocks", () => {
  const result = analyzeVisualMdxCompatibility(
    [
      "# Heading",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "$x_{i} = \\frac{a}{b}$",
      "",
      '<FeaturedPagesBlock title="Selected work" />',
    ].join("\n"),
  );

  assert.deepEqual(result, { compatible: true, issues: [] });
});

test("visual MDX compatibility rejects paired components and reports their line", () => {
  const result = analyzeVisualMdxCompatibility(
    ["Intro", "", '<Toggle title="References">', "Body", "</Toggle>"].join("\n"),
  );

  assert.equal(result.compatible, false);
  assert.equal(result.issues[0]?.code, "paired-component");
  assert.equal(result.issues[0]?.line, 3);
  assert.match(visualCompatibilitySummary(result), /^Line 3:/);
});

test("visual MDX compatibility rejects expressions, dynamic attributes, inline JSX, and ESM", () => {
  const cases = [
    ["Hello {name}", "expression"],
    ["<Chart points={points} />", "dynamic-component-attribute"],
    ["Hello <Badge />", "inline-component"],
    ["export const answer = 42", "module-syntax"],
  ];

  for (const [source, code] of cases) {
    const result = analyzeVisualMdxCompatibility(source);
    assert.equal(result.compatible, false, source);
    assert.equal(result.issues[0]?.code, code, source);
  }
});

test("visual MDX compatibility ignores component-like text inside code", () => {
  const result = analyzeVisualMdxCompatibility(
    ["```tsx", "<Toggle title={value}>", "{children}", "</Toggle>", "```"].join("\n"),
  );

  assert.equal(result.compatible, true);
});

test("visual MDX compatibility fails closed on invalid MDX", () => {
  const result = analyzeVisualMdxCompatibility("<Toggle>");

  assert.equal(result.compatible, false);
  assert.equal(result.issues[0]?.code, "syntax-error");
});
