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

function assertExcludes(source, forbidden, label) {
  assert.ok(!source.includes(forbidden), `${label} should not include ${forbidden}`);
}

test("public-web-style-guardrails: public content links keep Notion link classes", async () => {
  const richTextRenderer = await read("scripts/notion-sync/render-rich-text.mjs");
  const mdxComponents = await read("components/posts-mdx/components.tsx");
  const classicLink = await read("components/classic/classic-link.tsx");

  assertIncludes(
    richTextRenderer,
    'class="notion-link link"',
    "Notion sync rich-text renderer",
  );
  assertIncludes(
    mdxComponents,
    'joinClassNames("notion-link link", className)',
    "MDX link component",
  );
  assertIncludes(
    classicLink,
    'className = "notion-link link"',
    "ClassicLink default class",
  );
});

test("public-web-style-guardrails: classic list pages keep production Notion markup", async () => {
  const sources = {
    news: await read("components/news/news-view.tsx"),
    works: await read("components/works/works-view.tsx"),
    publications: await read("components/publications/publication-list.tsx"),
    blog: await read("components/blog-index/blog-index-list.tsx"),
  };

  assertIncludes(sources.news, "news-entry__body mdx-post__body", "News page");
  assertIncludes(sources.works, "notion-toggle closed works-toggle", "Works page");
  assertIncludes(
    sources.publications,
    "notion-toggle closed publication-toggle",
    "Publications page",
  );
  assertIncludes(sources.blog, "notion-collection inline", "Blog index");
  assertIncludes(
    sources.blog,
    "notion-collection-list__item",
    "Blog index collection item",
  );

  for (const [name, source] of Object.entries(sources)) {
    assertExcludes(source, "@/components/ui/list-row", `${name} page`);
    assertExcludes(source, "@/components/ui/card", `${name} page`);
    assertExcludes(source, "ListRow", `${name} page`);
    assertExcludes(source, "<Card", `${name} page`);
  }
});

test("public-web-style-guardrails: classic list page CSS does not reintroduce card borders", async () => {
  const cssFiles = [
    "app/(classic)/news.css",
    "app/(classic)/publications.css",
    "app/(classic)/works.css",
    "app/(classic)/teaching.css",
    "app/(classic)/blog-index.css",
  ];

  for (const relPath of cssFiles) {
    const source = await read(relPath);
    assert.doesNotMatch(
      source,
      /\bborder\s*:\s*1px\s+solid\b/i,
      `${relPath} should preserve the borderless production Notion list style`,
    );
    assert.doesNotMatch(
      source,
      /\bbox-shadow\s*:/i,
      `${relPath} should not add card shadows to public Notion list pages`,
    );
  }
});

test("public-web-style-guardrails: homepage classic link icons stay part of the contract", async () => {
  const homeCss = await read("app/(classic)/home.css");
  const iconContract = await read("scripts/_lib/classic-link-icons.mjs");

  const requiredHrefs = [
    'href="/blog"',
    'href="/chen"',
    'href="https://twitter.com/_jinnkunn"',
    'href="https://www.linkedin.com/in/jinkun-chen/"',
  ];

  for (const href of requiredHrefs) {
    assertIncludes(homeCss, href, "Homepage CSS link icon selectors");
    assertIncludes(iconContract, href, "Classic link icon runtime contract");
  }
});

test("public-web-style-guardrails: CDN home media bypasses Next image optimizer", async () => {
  const homeView = await read("components/home/home-view.tsx");

  assertIncludes(homeView, "function isCdnMediaSrc", "HomeView CDN media guard");
  assertIncludes(homeView, 'src.startsWith("https://cdn.jinkunchen.com/")', "HomeView CDN media guard");
  assertIncludes(homeView, "unoptimized={isCdnMediaSrc(src)}", "HomeView CDN media guard");
});

test("public-web-style-guardrails: MDX heading links inherit heading color", async () => {
  const postsCss = await read("app/(classic)/posts-mdx.css");

  assertIncludes(
    postsCss,
    ".mdx-post__body :is(h1, h2, h3, h4, h5, h6) a",
    "MDX heading link CSS",
  );
  assertIncludes(postsCss, ".mdx-post__body .notion-heading__anchor-link", "MDX heading link CSS");
  assertIncludes(postsCss, "color: inherit;", "MDX heading link CSS");
  assertIncludes(postsCss, "background-image: none;", "MDX heading link CSS");
  assertIncludes(postsCss, "text-decoration: none;", "MDX heading link CSS");
  assertIncludes(postsCss, "text-decoration-color: currentColor;", "MDX heading link CSS");
});

test("public-web-style-guardrails: MDX long links cannot widen mobile pages", async () => {
  const postsCss = await read("app/(classic)/posts-mdx.css");

  assertIncludes(postsCss, ".mdx-post__body a", "MDX long link wrapping CSS");
  assertIncludes(postsCss, "overflow-wrap: anywhere;", "MDX long link wrapping CSS");
  assertIncludes(postsCss, "word-break: break-word;", "MDX long link wrapping CSS");
});
