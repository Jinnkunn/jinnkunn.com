import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} should include ${expected}`);
}

test("rich-content-rendering-contract: MDX rich text keeps Notion-compatible wrappers", async () => {
  const components = await read("components/posts-mdx/components.tsx");
  const postView = await read("components/posts-mdx/post-view.tsx");
  const newsBlock = await read("components/posts-mdx/news-block.tsx");
  const newsEntry = await read("components/posts-mdx/news-entry.tsx");

  assertIncludes(
    components,
    'joinClassNames("notion-link link", className)',
    "MDX links",
  );
  assertIncludes(components, '"data-link-style"?: string', "icon link span props");
  assertIncludes(components, 'joinClassNames("notion-quote", className)', "quotes");
  assertIncludes(
    postView,
    "notion-page__properties mdx-post__meta ds-property-strip",
    "blog metadata strip",
  );
  assertIncludes(postView, "notion-property__date-icon", "blog date icon");
  assertIncludes(postView, "mdx-post__reading-icon", "blog reading-time icon");
  assertIncludes(newsBlock, "news-block__divider", "news divider renderer");
  assertIncludes(newsEntry, "news-entry__body mdx-post__body", "news body wrapper");
});

test("rich-content-rendering-contract: public CSS keeps quote, divider, icon-link, and meta affordances", async () => {
  const notionCss = await read("public/styles/notion.css");
  const notionBlocksCss = await read("app/(classic)/notion-blocks.css");
  const postsCss = await read("app/(classic)/posts-mdx.css");
  const newsCss = await read("app/(classic)/news.css");

  assertIncludes(notionCss, "border-inline-start: var(--quote-border)", "quote rail");
  assertIncludes(
    notionBlocksCss,
    ".notion-root span[data-link-style=\"icon\"] > a.notion-link.link",
    "icon link selector",
  );
  assertIncludes(notionBlocksCss, "text-decoration-color: var(--ds-link-underline)", "icon link underline");
  assertIncludes(postsCss, ".page__blog-post .mdx-post__meta", "blog meta strip CSS");
  assertIncludes(postsCss, "--mdx-post-reading-icon", "reading icon CSS mask");
  assertIncludes(newsCss, ".news-block__divider", "news divider CSS");
  assertIncludes(newsCss, ".news-entry__body hr", "inline news divider CSS");
});
