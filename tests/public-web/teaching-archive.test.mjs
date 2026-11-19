import assert from "node:assert/strict";
import test from "node:test";
import { createProcessor } from "@mdx-js/mdx";
import { compactTeachingArchiveLinks } from "../../lib/posts/teaching-archive.ts";
import { rankTeachingTerm } from "../../lib/shared/teaching-term.ts";

test("Teaching periods sort by season within the academic year", () => {
  const rows = ["2026/27 Fall Term", "Special topic", "2025/26 Summer Term", "2026/27 Winter Term"];
  assert.deepEqual(rows.sort((a, b) => rankTeachingTerm(b) - rankTeachingTerm(a)), [
    "2026/27 Winter Term", "2026/27 Fall Term", "2025/26 Summer Term", "Special topic",
  ]);
});

test("Teaching keeps the first archive control and other resource links in legacy MDX", () => {
  const tree = createProcessor().parse(`
[**Archived Course Pages**](/teaching/archive) **|** [Ratings](https://example.test/ratings)

<TeachingBlock />

[Appointment](https://example.test/appointment) · [Archive](/pages/teaching/archive/)

See the [historical archive](/teaching/archive) for a syllabus.

[Archive](/teaching/archive)
`);
  compactTeachingArchiveLinks(tree);
  const paragraphs = tree.children.filter((node) => node.type === "paragraph");
  assert.equal(paragraphs.length, 3);
  assert.deepEqual(paragraphs[0].children.filter((node) => node.type === "link").map((node) => node.url), [
    "/teaching/archive", "https://example.test/ratings",
  ]);
  assert.deepEqual(paragraphs[1].children.map((node) => node.url), ["https://example.test/appointment"]);
  assert.equal(paragraphs[2].children.find((node) => node.type === "link")?.url, "/teaching/archive");
});
