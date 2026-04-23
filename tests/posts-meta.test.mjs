import test from "node:test";
import assert from "node:assert/strict";

import { parsePostFile } from "../lib/posts/meta.ts";

const VALID_SOURCE = `---
title: Sample Post
date: 2026-03-14
description: An explicit description from frontmatter that wins over body extraction.
tags:
  - one
  - two
---

# Section

This is the first substantive paragraph. It is long enough to be a description if we
didn't have an explicit one in frontmatter. It should still be parsed without errors.

\`\`\`ts
const n: number = 1;
\`\`\`

- bullet a
- bullet b
`;

test("posts-meta: parses title/date/tags and formats display date", () => {
  const { entry, frontmatter } = parsePostFile("sample-post", VALID_SOURCE);
  assert.equal(entry.slug, "sample-post");
  assert.equal(entry.href, "/blog/sample-post");
  assert.equal(entry.title, "Sample Post");
  assert.equal(entry.dateIso, "2026-03-14");
  assert.equal(entry.dateText, "March 14, 2026");
  assert.deepEqual(entry.tags, ["one", "two"]);
  assert.equal(frontmatter.draft, false);
});

test("posts-meta: explicit frontmatter description wins over body", () => {
  const { entry } = parsePostFile("sample-post", VALID_SOURCE);
  assert.ok(entry.description);
  assert.ok(entry.description.startsWith("An explicit description"));
});

test("posts-meta: falls back to first substantive paragraph", () => {
  const src = `---
title: No Description Provided
date: 2026-01-01
---

Short line.

This is a body paragraph that is indeed long enough to pass the sixty character minimum description threshold.
`;
  const { entry } = parsePostFile("no-desc", src);
  assert.ok(entry.description);
  assert.ok(entry.description.startsWith("This is a body paragraph"));
});

test("posts-meta: strips code fences from word count", () => {
  const src = `---
title: Code-heavy
date: 2026-01-02
---

Body one two three four five six seven eight nine ten.

\`\`\`ts
function longFunctionWithManyWords() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10; }
\`\`\`
`;
  const { entry } = parsePostFile("code", src);
  // Only the body line should be counted. Fence body is stripped.
  assert.ok(entry.wordCount > 5 && entry.wordCount < 20, `got ${entry.wordCount}`);
  assert.ok(entry.readingMinutes >= 1);
});

test("posts-meta: throws on missing required frontmatter", () => {
  const src = `---
description: no title
---

Body.
`;
  assert.throws(() => parsePostFile("broken", src));
});

test("posts-meta: throws on unparseable date", () => {
  const src = `---
title: Bad Date
date: not-a-date
---

Body.
`;
  assert.throws(() => parsePostFile("bad-date", src));
});

test("posts-meta: draft flag flows through", () => {
  const src = `---
title: Work in progress
date: 2026-02-02
draft: true
---

Body copy long enough to be a description if necessary.
`;
  const { entry } = parsePostFile("wip", src);
  assert.equal(entry.draft, true);
});
