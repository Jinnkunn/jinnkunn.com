import test from "node:test";
import assert from "node:assert/strict";

import { parseBlogMetaFromMain } from "../lib/blog-meta.ts";

const SHORT_POST_HTML = `
<main>
  <div class="notion-header">
    <h1 class="notion-header__title">Sample Post Title</h1>
  </div>
  <article>
    <div class="notion-page__properties">
      <div class="notion-page__property">
        <span class="date">January 5, 2026</span>
      </div>
    </div>
    <p class="notion-text">A pithy subtitle.</p>
    <p class="notion-text">
      This is the first substantive paragraph that describes what the blog post is about.
      It is long enough to serve as a description for the blog index.
    </p>
    <p class="notion-text">A follow-up paragraph that should not be used for the excerpt.</p>
  </article>
</main>
`;

test("blog-meta: extracts title, date, description, word count", () => {
  const meta = parseBlogMetaFromMain(SHORT_POST_HTML);
  assert.equal(meta.title, "Sample Post Title");
  assert.equal(meta.dateText, "January 5, 2026");
  assert.equal(meta.dateIso, "2026-01-05");
  assert.ok(meta.description);
  assert.ok(
    meta.description.startsWith("This is the first substantive paragraph"),
    `description should start with the first substantive paragraph, got: ${meta.description}`,
  );
  assert.ok(meta.wordCount > 5);
  assert.ok(meta.readingMinutes >= 1);
});

test("blog-meta: skips short subtitle paragraphs", () => {
  const html = `
    <main>
      <div class="notion-header"><h1 class="notion-header__title">Headline Only</h1></div>
      <article>
        <p class="notion-text">Too short.</p>
        <p class="notion-text">Also short.</p>
        <p class="notion-text">This one is indeed long enough to clear the sixty character minimum for descriptions.</p>
      </article>
    </main>
  `;
  const meta = parseBlogMetaFromMain(html);
  assert.ok(meta.description);
  assert.ok(meta.description.startsWith("This one is indeed long enough"));
});

test("blog-meta: trims long descriptions to ~200 chars with ellipsis", () => {
  const longPara =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit.";
  const html = `
    <main>
      <div class="notion-header"><h1 class="notion-header__title">Long</h1></div>
      <article>
        <p class="notion-text">${longPara}</p>
      </article>
    </main>
  `;
  const meta = parseBlogMetaFromMain(html);
  assert.ok(meta.description);
  assert.ok(meta.description.length <= 205, `expected <=205, got ${meta.description.length}`);
  assert.ok(meta.description.endsWith("…"));
});

test("blog-meta: null description when no paragraphs are long enough", () => {
  const html = `
    <main>
      <div class="notion-header"><h1 class="notion-header__title">Empty</h1></div>
      <article>
        <p class="notion-text">Tiny.</p>
      </article>
    </main>
  `;
  const meta = parseBlogMetaFromMain(html);
  assert.equal(meta.description, null);
});

test("blog-meta: word count treats HTML structure as whitespace", () => {
  const html = `
    <main>
      <div class="notion-header"><h1 class="notion-header__title">X</h1></div>
      <article>
        <p class="notion-text">one two three four five six seven eight nine ten</p>
      </article>
    </main>
  `;
  const meta = parseBlogMetaFromMain(html);
  assert.equal(meta.wordCount, 10);
});

test("blog-meta: missing date yields null fields without throwing", () => {
  const html = `
    <main>
      <div class="notion-header"><h1 class="notion-header__title">No Date Post</h1></div>
      <article>
        <p class="notion-text">Body paragraph long enough to serve as description text here.</p>
      </article>
    </main>
  `;
  const meta = parseBlogMetaFromMain(html);
  assert.equal(meta.dateText, null);
  assert.equal(meta.dateIso, null);
  assert.equal(meta.title, "No Date Post");
});
