import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ICON_LINK_REGISTRY = JSON.parse(
  fsSync.readFileSync(path.join(ROOT, "lib/shared/icon-link-registry.json"), "utf8"),
);

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} should include ${expected}`);
}

function assertExcludes(source, forbidden, label) {
  assert.ok(!source.includes(forbidden), `${label} should not include ${forbidden}`);
}

async function collectFiles(dirPath, predicate) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, predicate)));
      continue;
    }
    if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function collectEditableContentSources() {
  const sources = [
    {
      relPath: "content/home.json",
      source: JSON.parse(await read("content/home.json")).bodyMdx ?? "",
    },
  ];

  for (const dir of ["content/pages", "content/components", "content/posts"]) {
    const absDir = path.join(ROOT, dir);
    const files = await collectFiles(absDir, (filePath) => filePath.endsWith(".mdx"));
    for (const filePath of files) {
      sources.push({
        relPath: path.relative(ROOT, filePath),
        source: await fs.readFile(filePath, "utf8"),
      });
    }
  }

  return sources;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcherToRegExp(matcher) {
  if (matcher.kind === "contains") {
    return new RegExp(escapeRegExp(matcher.value));
  }
  if (matcher.kind === "prefix") {
    return new RegExp(`^${escapeRegExp(matcher.value)}`);
  }
  return new RegExp(`^${escapeRegExp(matcher.value).replace(/\/$/, "")}\\/?(?:[#?].*)?$`);
}

const KNOWN_ICON_LINK_TARGETS = ICON_LINK_REGISTRY.flatMap((entry) =>
  entry.matchers.map(matcherToRegExp),
);

function hrefSelector(matcher) {
  if (matcher.kind === "contains") return `href*="${matcher.value}"`;
  if (matcher.kind === "prefix") return `href^="${matcher.value}"`;
  return `href="${matcher.value}"`;
}

function explicitIconSelector(entry) {
  const preferred =
    entry.matchers.find((matcher) => matcher.value.startsWith("https://www.")) ??
    entry.matchers.find((matcher) => matcher.kind === "exact") ??
    entry.matchers[0];
  return `span[data-link-style="icon"] > a[${hrefSelector(preferred)}].notion-link.link:before`;
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

test("public-web-style-guardrails: visual contracts cover the public route matrix", async () => {
  const classicContract = await read("scripts/classic-style-contract.mjs");
  const productionContract = await read("scripts/production-style-regression.mjs");
  const requiredRoutes = [
    "/",
    "/news",
    "/publications",
    "/works",
    "/teaching",
    "/blog",
    "/bio",
    "/connect",
    "/chen",
  ];

  for (const route of requiredRoutes) {
    assertIncludes(classicContract, `path: "${route}"`, `Classic style contract route ${route}`);
    assertIncludes(
      productionContract,
      `path: "${route}"`,
      `Production style regression route ${route}`,
    );
  }

  for (const expected of [
    "LINK_STYLE_PROBES",
    "CLASSIC_LINK_OPACITY",
    "gray text color drifted from the Notion gray mark contract",
    "Homepage body paragraph spacing drifted from the classic Notion contract",
    "Text block",
    "Bulleted list item",
    "Toggle block",
    "News inline link",
    "Works internal link",
    "Bio certification link",
    "Connect profile link",
  ]) {
    assertIncludes(productionContract, expected, "Production style regression probes");
  }
});

test("public-web-style-guardrails: classic list pages keep production Notion markup", async () => {
  const sources = {
    // News rendering lives on the per-entry `<NewsEntry>` MDX component
    // since `content/pages/news.mdx` is the source of truth — `<NewsBlock />`
    // re-uses the same entry component for embeds (e.g. Home top-N).
    news: await read("components/posts-mdx/news-entry.tsx"),
    works: await read("components/posts-mdx/works-entry.tsx"),
    publications: await read("components/publications/publication-list.tsx"),
    blog: await read("components/blog-index/blog-index-list.tsx"),
  };

  assertIncludes(sources.news, "news-entry__body mdx-post__body", "News entry");
  assertIncludes(sources.works, "notion-toggle closed works-toggle", "Works entry");
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

test("public-web-style-guardrails: data-page entry components keep legacy Notion markup", async () => {
  // After the news / works / teaching / publications panel-to-MDX
  // migration, each row on those pages renders through a per-entry
  // server component. The component source is the contract the
  // existing CSS in app/(classic)/{news,works,teaching,publications}.css
  // hangs off — keep the class strings load-bearing so a future
  // refactor that drops one breaks here, not in production.
  const newsEntry = await read("components/posts-mdx/news-entry.tsx");
  assertIncludes(
    newsEntry,
    'className="notion-heading notion-semantic-string"',
    "NewsEntry heading",
  );
  assertIncludes(
    newsEntry,
    'className="news-entry__body mdx-post__body"',
    "NewsEntry body wrapper",
  );

  const worksEntry = await read("components/posts-mdx/works-entry.tsx");
  assertIncludes(
    worksEntry,
    'className="notion-toggle closed works-toggle"',
    "WorksEntry toggle wrapper",
  );
  assertIncludes(
    worksEntry,
    'className="mdx-post__body works-toggle__body"',
    "WorksEntry body class",
  );
  assertIncludes(
    worksEntry,
    'className="highlighted-background bg-yellow"',
    "WorksEntry affiliation highlight",
  );

  const teachingEntry = await read("components/posts-mdx/teaching-entry.tsx");
  assertIncludes(
    teachingEntry,
    'className="notion-list-item notion-semantic-string teaching-item"',
    "TeachingEntry list item",
  );
  assertIncludes(
    teachingEntry,
    'className="highlighted-color color-gray"',
    "TeachingEntry muted spans",
  );

  const teachingLinks = await read("components/posts-mdx/teaching-links.tsx");
  assertIncludes(
    teachingLinks,
    'className="teaching-link-divider"',
    "TeachingLinks divider class",
  );
  assertIncludes(
    teachingLinks,
    'className="notion-text notion-text__content notion-semantic-string teaching-footer-links"',
    "TeachingLinks footer wrapper",
  );

  const teachingPage = await read("content/pages/teaching.mdx");
  assertIncludes(teachingPage, "<TeachingBlock", "Teaching page teaching block");
  assertExcludes(
    teachingPage,
    "<TeachingLinks",
    "Teaching page legacy link-row component",
  );

  const publicationsEntry = await read("components/posts-mdx/publications-entry.tsx");
  assertIncludes(
    publicationsEntry,
    'className="notion-toggle closed publication-toggle"',
    "PublicationsEntry toggle wrapper",
  );
  assertIncludes(
    publicationsEntry,
    'className="pub-tag-prefix"',
    "PublicationsEntry tag prefix",
  );
  assertIncludes(
    publicationsEntry,
    'className="pub-tag-colon"',
    "PublicationsEntry tag colon",
  );

  const profileLinks = await read("components/posts-mdx/publications-profile-links.tsx");
  assertIncludes(
    profileLinks,
    'className="highlighted-background bg-yellow"',
    "PublicationsProfileLinks highlight",
  );
  assertIncludes(
    profileLinks,
    'className="teaching-link-divider"',
    "PublicationsProfileLinks divider (shared with teaching)",
  );
});

test("public-web-style-guardrails: data-page entry components are registered for MDX use", async () => {
  // The page MDX (`content/pages/{news,works,teaching,publications}.mdx`)
  // can only render `<NewsEntry>` etc. if the matching component is
  // exposed via postMdxComponents; otherwise MDX falls through to the
  // raw HTML element name and we lose all the per-entry rendering.
  const components = await read("components/posts-mdx/components.tsx");
  for (const symbol of [
    "NewsEntry",
    "WorksEntry",
    "TeachingEntry",
    "TeachingLinks",
    "PublicationsEntry",
    "PublicationsProfileLinks",
  ]) {
    assertIncludes(
      components,
      `import { ${symbol} }`,
      `postMdxComponents imports ${symbol}`,
    );
    // The literal string `\n  Foo,` is how the component is registered
    // in the exported map (one symbol per line, two-space indent).
    assertIncludes(components, `\n  ${symbol},`, `postMdxComponents registers ${symbol}`);
  }
});

test("public-web-style-guardrails: data-page files split between pages (shortcode) and components (entries)", async () => {
  // After the Components migration: each public route page MDX
  // contains a single `<{Name}Block />` shortcode (no inline entries),
  // and the matching `content/components/{name}.mdx` holds the actual
  // entry tags. Belt-and-suspenders: CI screams if someone reverts
  // the split or mass-replaces the entry tag in a refactor.
  const news = await read("content/pages/news.mdx");
  assertIncludes(news, "<NewsBlock", "news.mdx embeds the NewsBlock shortcode");
  assertIncludes(news, 'title: "News"', "news.mdx frontmatter title");
  const newsComponent = await read("content/components/news.mdx");
  assertIncludes(
    newsComponent,
    "<NewsEntry date=",
    "components/news.mdx contains NewsEntry blocks",
  );

  const works = await read("content/pages/works.mdx");
  assertIncludes(works, "<WorksBlock", "works.mdx embeds the WorksBlock shortcode");
  // The "Recent Works" / "Past Works" headings are now emitted by
  // WorksBlock itself; verify the block source carries them so the
  // visual output stays identical.
  const worksBlock = await read("components/posts-mdx/works-block.tsx");
  assertIncludes(worksBlock, "Recent Works", "works-block emits Recent Works heading");
  assertIncludes(worksBlock, "Past Works", "works-block emits Past Works heading");
  const worksComponent = await read("content/components/works.mdx");
  assertIncludes(
    worksComponent,
    "<WorksEntry category=",
    "components/works.mdx contains WorksEntry blocks",
  );

  const teaching = await read("content/pages/teaching.mdx");
  assertIncludes(
    teaching,
    "<TeachingBlock",
    "teaching.mdx embeds the TeachingBlock shortcode",
  );
  // The legacy `<ul className="notion-bulleted-list teaching-list">`
  // wrapper is now emitted by TeachingBlock itself.
  const teachingBlock = await read("components/posts-mdx/teaching-block.tsx");
  assertIncludes(
    teachingBlock,
    'className="notion-bulleted-list teaching-list"',
    "teaching-block wraps entries in the legacy <ul>",
  );
  const teachingComponent = await read("content/components/teaching.mdx");
  assertIncludes(
    teachingComponent,
    "<TeachingEntry term=",
    "components/teaching.mdx contains TeachingEntry blocks",
  );

  const publications = await read("content/pages/publications.mdx");
  assertIncludes(
    publications,
    "<PublicationsBlock",
    "publications.mdx embeds the PublicationsBlock shortcode",
  );
  assertIncludes(
    publications,
    'data-link-style="icon"',
    "publications.mdx contains inline icon profile links",
  );
  assertExcludes(
    publications,
    "<PublicationsProfileLinks",
    "publications.mdx legacy profile links block",
  );
  const publicationsComponent = await read("content/components/publications.mdx");
  assertIncludes(
    publicationsComponent,
    "<PublicationsEntry data=",
    "components/publications.mdx contains PublicationsEntry blocks",
  );
});

test("public-web-style-guardrails: data-page embed blocks read from components, not pages or legacy JSON", async () => {
  // The four `<NewsBlock />` / `<WorksBlock />` / `<TeachingBlock />` /
  // `<PublicationsBlock />` MDX components must read entries from
  // `content/components/{name}.mdx` (the dedicated component file
  // edited via the admin Components panel). Catch any regression that
  // re-points at the public page MDX or re-imports the deleted JSON.
  const blocks = {
    news: await read("components/posts-mdx/news-block.tsx"),
    works: await read("components/posts-mdx/works-block.tsx"),
    teaching: await read("components/posts-mdx/teaching-block.tsx"),
    publications: await read("components/posts-mdx/publications-block.tsx"),
  };
  for (const [name, source] of Object.entries(blocks)) {
    assertIncludes(
      source,
      `getSiteComponentDefinition("${name}")`,
      `${name}-block reads its source path from the component registry`,
    );
    assertIncludes(
      source,
      "@/lib/components/parse",
      `${name}-block uses the shared component parser`,
    );
    assertExcludes(
      source,
      `@/content/${name}.json`,
      `${name}-block must not import the deleted JSON`,
    );
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

test("public-web-style-guardrails: classic icon links are explicit variants of Notion links", async () => {
  const publicInlineCss = await read("public/styles/super-inline.css");
  const iconContract = await read("scripts/_lib/classic-link-icons.mjs");
  const { CLASSIC_LINK_ICON_CONTRACT } = await import(
    new URL("../scripts/_lib/classic-link-icons.mjs", import.meta.url)
  );
  const blogIndexView = await read("components/blog-index/blog-index-view.tsx");

  const explicitIconSelectors = ICON_LINK_REGISTRY.map(explicitIconSelector);
  const runtimeSelectors = new Set(
    CLASSIC_LINK_ICON_CONTRACT.map((item) => item.selector),
  );

  assertIncludes(publicInlineCss, "a.notion-link.link {", "Shared Notion link style");
  assertIncludes(
    iconContract,
    "icon-link-registry.json",
    "Classic icon contract source of truth",
  );
  assertIncludes(publicInlineCss, "background-image:", "Shared Notion link style");
  assertIncludes(
    publicInlineCss,
    "color: inherit;",
    "Shared Notion link default state",
  );
  assertIncludes(
    publicInlineCss,
    "opacity: 0.7;",
    "Shared Notion link default opacity mask",
  );
  assertIncludes(publicInlineCss, "opacity: 1;", "Shared Notion link hover state");
  assert.doesNotMatch(
    publicInlineCss,
    /a\.notion-link\.link\s*\{[^}]*color:\s*var\(--color-text-(?:gray|default)\);/,
    "Shared Notion links should inherit user-set text color instead of forcing gray/black",
  );
  assertIncludes(
    publicInlineCss,
    "Icon-prefixed links: only the icon slot differs",
    "Inline icon link contract",
  );
  assertIncludes(publicInlineCss, "data-link-icon", "Custom inline icon link contract");
  assertIncludes(publicInlineCss, "--link-icon-image", "Custom inline icon link contract");
  assertIncludes(blogIndexView, 'data-link-style="icon"', "Blog RSS link");
  assert.doesNotMatch(
    publicInlineCss,
    /(^|,)\s*a\[href[^\n,{]*\.notion-link\.link::?before/m,
    "Public icon CSS should not turn links into icons by URL alone",
  );
  assert.doesNotMatch(
    iconContract,
    /selector:\s*['"]a\[href/,
    "Runtime icon contract should query explicit icon links, not every matching URL",
  );

  for (const selector of explicitIconSelectors) {
    assertIncludes(publicInlineCss, selector, "Explicit inline icon selectors");
    assert.ok(
      runtimeSelectors.has(selector.replace(":before", "")),
      `Classic link icon runtime contract should include ${selector}`,
    );
  }
});

test("public-web-style-guardrails: known icon links use explicit inline icon marks", async () => {
  const sources = await collectEditableContentSources();
  const missingMarks = [];
  const markdownLinkPattern =
    /(<span\s+data-link-style="icon">\s*)?\[([^\]\n]+)\]\(([^)\n]+)\)(\s*<\/span>)?/g;

  for (const { relPath, source } of sources) {
    for (const match of source.matchAll(markdownLinkPattern)) {
      const [, openingMark, label, href, closingMark] = match;
      const shouldBeIconLink = KNOWN_ICON_LINK_TARGETS.some((pattern) => pattern.test(href));
      const isMarked = Boolean(openingMark && closingMark);
      if (shouldBeIconLink && !isMarked) {
        missingMarks.push(`${relPath}: ${label} -> ${href}`);
      }
    }
  }

  assert.deepEqual(missingMarks, []);
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

test("public-web-style-guardrails: classic gray text is content-level, not page-level", async () => {
  const bridgeCss = await read("app/(classic)/design-system-bridge.css");
  const homeCss = await read("app/(classic)/home.css");
  const mdxCss = await read("app/(classic)/posts-mdx.css");
  const newsCss = await read("app/(classic)/news.css");
  const worksCss = await read("app/(classic)/works.css");
  const teachingCss = await read("app/(classic)/teaching.css");
  const notionBlocksCss = await read("app/(classic)/notion-blocks.css");
  const homeContent = JSON.parse(await read("content/home.json")).bodyMdx ?? "";

  assertIncludes(
    bridgeCss,
    "--color-text-gray: var(--ds-color-text-gray)",
    "Classic design-system bridge",
  );
  assertIncludes(notionBlocksCss, 'span[data-color="gray"]', "Classic inline gray mark CSS");
  assertIncludes(
    homeCss,
    ".page__index .home-layout--variant-classicIntro .home-section__body strong,\n.page__index .home-rich-text--variant-classicBody .home-section__body strong {\n  color: var(--color-text-default);",
    "Homepage emphasized copy",
  );
  assertIncludes(
    mdxCss,
    ".mdx-post__body strong,",
    "MDX emphasized copy",
  );
  assertIncludes(
    mdxCss,
    ".mdx-post__body > span[data-color]",
    "MDX direct inline color block",
  );
  assertIncludes(
    homeCss,
    ".page__index .mdx-post__body > :is(p, span[data-color])",
    "Homepage direct inline color rhythm",
  );
  for (const [label, source] of [
    ["Homepage CSS", homeCss],
    ["MDX CSS", mdxCss],
    ["News CSS", newsCss],
    ["Works CSS", worksCss],
    ["Teaching CSS", teachingCss],
  ]) {
    assertExcludes(
      source,
      "color: var(--color-text-default-light);",
      `${label} page-level copy color`,
    );
  }
  assertIncludes(homeContent, 'data-color="gray"', "Home content explicit gray mark");
});

test("public-web-style-guardrails: icon links use the same underline token as content links", async () => {
  const designCss = await read("app/design-system.css");
  const superInlineCss = await read("public/styles/super-inline.css");
  const notionBlocksCss = await read("app/(classic)/notion-blocks.css");

  assertIncludes(designCss, "--ds-link-underline:", "Design tokens");
  assertIncludes(designCss, "--ds-link-underline-hover:", "Design tokens");
  assertIncludes(
    superInlineCss,
    "text-decoration-color: var(--ds-link-underline, rgba(55, 53, 47, 0.55));",
    "Classic content links",
  );
  assertIncludes(
    superInlineCss,
    "text-decoration-color: var(--ds-link-underline-hover, rgba(55, 53, 47, 0.78));",
    "Classic content links hover",
  );
  assertIncludes(
    notionBlocksCss,
    "text-decoration-color: var(--ds-link-underline);",
    "Classic icon links",
  );
  assertIncludes(
    notionBlocksCss,
    "text-decoration-color: var(--ds-link-underline-hover);",
    "Classic icon links hover",
  );
  assertExcludes(
    notionBlocksCss,
    "text-decoration-color: var(--ds-toc-underline);",
    "Classic icon links",
  );
});

test("public-web-style-guardrails: MDX heading links inherit heading color", async () => {
  const postsCss = await read("app/(classic)/posts-mdx.css");

  assert.doesNotMatch(
    postsCss,
    /\.mdx-post__body\s+:is\(p,\s*li,\s*blockquote\)\s+a\.notion-link\.link/,
    "MDX body links should inherit the shared Blog RSS link baseline",
  );
  assert.doesNotMatch(
    postsCss,
    /\.mdx-post__body\s+:is\(strong,\s*b\)\s+a\.notion-link\.link/,
    "Bold MDX links should inherit the shared Blog RSS link baseline",
  );
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
