import test from "node:test";
import assert from "node:assert/strict";
import { collectPostHeadings, shouldShowPostOutline } from "../../lib/posts/outline.ts";
test("post outline uses compiled heading IDs, inline text, and only H2/H3", () => {
  const headings = collectPostHeadings({ children: [
    { tagName: "h1", properties: { id: "title" }, children: [{ value: "Title" }] },
    { tagName: "h2", properties: { id: "same" }, children: [{ value: "A " }, { tagName: "em", children: [{ value: "heading" }] }] },
    { tagName: "h3", properties: { id: "same-1" }, children: [{ value: "Next" }, { properties: { ariaHidden: true }, children: [{ value: "#" }] }] },
  ] });
  assert.deepEqual(headings, [{ id: "same", title: "A heading", level: 2 }, { id: "same-1", title: "Next", level: 3 }]);
  assert.equal(shouldShowPostOutline(1000, headings), false);
  assert.equal(shouldShowPostOutline(100, [...headings, headings[0]]), false);
  assert.equal(shouldShowPostOutline(800, [...headings, headings[0]]), true);
});
