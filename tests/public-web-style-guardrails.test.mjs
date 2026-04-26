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
    // News rendering lives on the per-entry `<NewsEntry>` MDX component
    // since `content/pages/news.mdx` is the source of truth — `<NewsBlock />`
    // re-uses the same entry component for embeds (e.g. Home top-N).
    news: await read("components/posts-mdx/news-entry.tsx"),
    works: await read("components/posts-mdx/works-block.tsx"),
    publications: await read("components/publications/publication-list.tsx"),
    blog: await read("components/blog-index/blog-index-list.tsx"),
  };

  assertIncludes(sources.news, "news-entry__body mdx-post__body", "News entry");
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
  // Home rendering moved to a single MDX document — the CDN-bypass
  // guard moved with the profile image into HeroBlock, which is the
  // component that actually mounts <Image> on the public Home now.
  const heroBlock = await read("components/posts-mdx/hero-block.tsx");

  assertIncludes(heroBlock, "function isCdnMediaSrc", "HeroBlock CDN media guard");
  assertIncludes(heroBlock, 'src.startsWith("https://cdn.jinkunchen.com/")', "HeroBlock CDN media guard");
  assertIncludes(heroBlock, "unoptimized={isCdnMediaSrc(imageUrl)}", "HeroBlock CDN media guard");
});

test("public-web-style-guardrails: classic body copy keeps production gray tone", async () => {
  const bridgeCss = await read("app/(classic)/design-system-bridge.css");
  const homeCss = await read("app/(classic)/home.css");
  const mdxCss = await read("app/(classic)/posts-mdx.css");
  const newsCss = await read("app/(classic)/news.css");
  const worksCss = await read("app/(classic)/works.css");
  const teachingCss = await read("app/(classic)/teaching.css");

  assertIncludes(
    bridgeCss,
    "--color-text-gray: var(--ds-text-faint)",
    "Classic design-system bridge",
  );
  assertIncludes(
    homeCss,
    ".page__index .home-layout--variant-classicIntro .home-section__body,\n.page__index .home-rich-text--variant-classicBody .home-section__body {\n  color: var(--color-text-default-light);",
    "Homepage classic copy",
  );
  assertIncludes(
    homeCss,
    ".page__index .home-layout--variant-classicIntro .home-section__body strong,\n.page__index .home-rich-text--variant-classicBody .home-section__body strong {\n  color: var(--color-text-default);",
    "Homepage emphasized copy",
  );
  assertIncludes(
    mdxCss,
    "color: var(--color-text-default-light);",
    "MDX body copy",
  );
  assertIncludes(
    mdxCss,
    ".mdx-post__body strong,",
    "MDX emphasized copy",
  );
  assertIncludes(newsCss, "color: var(--color-text-default-light);", "News copy");
  assertIncludes(worksCss, "color: var(--color-text-default-light);", "Works copy");
  assertIncludes(teachingCss, "color: var(--color-text-default-light);", "Teaching copy");
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

test("public-web-style-guardrails: MDX toggles and code blocks keep Notion interactions", async () => {
  const components = await read("components/posts-mdx/components.tsx");
  const postsCss = await read("app/(classic)/posts-mdx.css");
  const toggles = await read("lib/client/notion/toggles.ts");

  assertIncludes(components, "function MdxPre", "MDX code copy component");
  assertIncludes(components, 'className="notion-code no-wrap mdx-code"', "MDX code copy component");
  assertIncludes(components, 'className="notion-code__copy-button"', "MDX code copy component");
  assertIncludes(components, "pre: MdxPre", "MDX code copy component");
  assertIncludes(
    await read("components/posts-mdx/toggle.tsx"),
    "notion-toggle mdx-toggle",
    "MDX toggle legacy Notion markup",
  );
  assertIncludes(postsCss, ".mdx-code .notion-code__copy-button", "MDX code copy component");
  assertIncludes(postsCss, "pointer-events: all;", "MDX code copy component");
  assertIncludes(toggles, "toggle instanceof HTMLDetailsElement", "MDX native details toggle support");
  assertIncludes(toggles, "toggle.open = open;", "MDX native details toggle support");
});

test("public-web-style-guardrails: migrated MDX keeps Notion toggles semantic", async () => {
  const postsDir = path.join(ROOT, "content/posts");
  const files = (await fs.readdir(postsDir)).filter((file) => file.endsWith(".mdx"));

  for (const file of files) {
    const source = await fs.readFile(path.join(postsDir, file), "utf8");
    assert.doesNotMatch(
      source,
      /(?:^|\n)\s*‣\s*(?:\n|$)/,
      `${file} should not contain orphan Notion toggle markers`,
    );
    assert.doesNotMatch(
      source,
      /(?:^|\n)\s*Copy\s*\n+```/,
      `${file} should not contain copied Notion code-button text before code fences`,
    );
  }

  const orderSensitivity = await read(
    "content/posts/context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities.mdx",
  );
  assertIncludes(
    orderSensitivity,
    '<Toggle title="Implementation sketch">',
    "Order-sensitivity implementation sketch toggle",
  );
});
