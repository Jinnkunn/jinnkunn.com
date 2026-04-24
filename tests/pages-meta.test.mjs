import test from "node:test";
import assert from "node:assert/strict";

import { parsePageFile } from "../lib/pages/meta.ts";

test("pages-meta: parses title and routes to /pages/:slug", () => {
  const source = `---
title: About Me
---

This is a single page about the author.
`;
  const { entry } = parsePageFile("about", source);
  assert.equal(entry.slug, "about");
  assert.equal(entry.href, "/pages/about");
  assert.equal(entry.title, "About Me");
  assert.equal(entry.updatedIso, null);
  assert.equal(entry.draft, false);
});

test("pages-meta: supports optional `updated` ISO date", () => {
  const source = `---
title: Contact
updated: 2026-02-02
---

Body that is long enough to serve as a description when we need one.
`;
  const { entry } = parsePageFile("contact", source);
  assert.equal(entry.updatedIso, "2026-02-02");
});

test("pages-meta: requires title", () => {
  const source = `---
description: missing title
---

body
`;
  assert.throws(() => parsePageFile("bad", source));
});

test("pages-meta: explicit description wins", () => {
  const source = `---
title: With Description
description: Explicit description from frontmatter.
---

Body paragraph long enough to serve as a fallback description but should not be used.
`;
  const { entry } = parsePageFile("d", source);
  assert.ok(entry.description);
  assert.equal(entry.description, "Explicit description from frontmatter.");
});

test("pages-meta: draft flag flows through", () => {
  const source = `---
title: In Progress
draft: true
---

Body copy that is long enough to be a description when rendered but should not be because of draft.
`;
  const { entry } = parsePageFile("wip", source);
  assert.equal(entry.draft, true);
});
