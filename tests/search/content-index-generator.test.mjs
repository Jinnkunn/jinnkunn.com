import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildContentIndexes, extractSearchFieldsFromMdx } from "../../scripts/build/prebuild.mjs";
import { parsePageFile } from "../../lib/pages/meta.ts";
import { parsePostFile } from "../../lib/posts/meta.ts";
import { SITE_COMPONENT_DEFINITIONS } from "../../lib/site-admin/component-registry.ts";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

// Independent oracle: walk the MDX tree here rather than reusing the
// generator's own walker, so a bug in the walker cannot hide itself.
function listMdx(dir, recursive, prefix = "") {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of ents) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (recursive) out.push(...listMdx(path.join(dir, ent.name), true, rel));
      continue;
    }
    if (ent.isFile() && /\.mdx?$/.test(ent.name)) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function readRepoContent() {
  const pages = listMdx(path.join(REPO_ROOT, "content", "pages"), true).map((rel) => {
    const slug = rel.replace(/\.mdx?$/, "");
    const source = fs.readFileSync(path.join(REPO_ROOT, "content", "pages", rel), "utf8");
    return { slug, routePath: `/${slug}`, entry: parsePageFile(slug, source).entry };
  });
  const posts = listMdx(path.join(REPO_ROOT, "content", "posts"), false).map((rel) => {
    const slug = rel.replace(/\.mdx?$/, "");
    const source = fs.readFileSync(path.join(REPO_ROOT, "content", "posts", rel), "utf8");
    return { slug, routePath: `/blog/${slug}`, entry: parsePostFile(slug, source).entry };
  });
  return { pages, posts };
}

function readGenerated(name) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "content", "generated", name), "utf8"));
}

// Same precedence `getProtectedRoutes()` uses at runtime.
function readProtectedPrefixes() {
  for (const dir of ["local", "filesystem", "generated"]) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "content", dir, "protected-routes.json"), "utf8"),
      );
      if (Array.isArray(parsed)) {
        return parsed.map((rule) => String(rule?.path || "")).filter((p) => p && p !== "/");
      }
    } catch {
      // try the next root
    }
  }
  return [];
}

function isProtected(routePath, prefixes) {
  return prefixes.some((prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`));
}

test("content index: every published page and post gets a generated route", () => {
  const { routes } = buildContentIndexes(REPO_ROOT);
  const byRoute = new Map(routes.map((r) => [r.routePath, r]));
  const { pages, posts } = readRepoContent();

  assert.ok(pages.length > 0, "expected content/pages/**.mdx to exist");
  assert.ok(posts.length > 0, "expected content/posts/*.mdx to exist");

  for (const item of [...pages, ...posts]) {
    const generated = byRoute.get(item.routePath);
    assert.ok(generated, `missing generated route for ${item.routePath}`);
    // The generator must agree with the parsers the app itself uses.
    assert.equal(generated.title, item.entry.title, `title mismatch for ${item.routePath}`);
    assert.equal(generated.draft, item.entry.draft, `draft mismatch for ${item.routePath}`);
  }
});

test("content index: search index covers every published slug and excludes drafts", () => {
  const { routes, searchIndex } = buildContentIndexes(REPO_ROOT);
  const indexed = new Set(searchIndex.map((item) => item.routePath));
  const protectedPrefixes = readProtectedPrefixes();

  const published = routes.filter((r) => !r.draft);
  const drafts = routes.filter((r) => r.draft);
  assert.ok(published.length > 0);

  for (const route of published) {
    if (isProtected(route.routePath, protectedPrefixes)) continue;
    assert.ok(indexed.has(route.routePath), `search index is missing ${route.routePath}`);
  }
  for (const route of drafts) {
    assert.equal(indexed.has(route.routePath), false, `draft leaked into search index: ${route.routePath}`);
  }

  for (const item of searchIndex) {
    assert.ok(item.id, `missing id for ${item.routePath}`);
    assert.ok(item.title, `missing title for ${item.routePath}`);
  }
  assert.equal(new Set(searchIndex.map((i) => i.id)).size, searchIndex.length, "ids must be unique");
});

test("content index: lastmod comes from frontmatter, not file mtime", () => {
  const { routes } = buildContentIndexes(REPO_ROOT);
  const byRoute = new Map(routes.map((r) => [r.routePath, r]));
  const { posts } = readRepoContent();

  for (const post of posts) {
    const generated = byRoute.get(post.routePath);
    assert.ok(generated?.lastmod, `missing lastmod for ${post.routePath}`);
    assert.equal(
      generated.lastmod.slice(0, 10),
      post.entry.dateIso,
      `lastmod should track frontmatter date for ${post.routePath}`,
    );
  }
});

test("content index: generated artifacts on disk are current, not frozen", () => {
  const { routes, searchIndex } = buildContentIndexes(REPO_ROOT);
  // `writeIfMissing` used to leave `search-index.json` frozen at whatever the
  // retired Notion sync last wrote. If this fails, run `node scripts/build/prebuild.mjs`.
  assert.deepEqual(readGenerated("content-routes.json"), routes);
  assert.deepEqual(readGenerated("search-index.json"), searchIndex);
});

test("content index: drafts and malformed files are skipped loudly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-"));
  try {
    fs.mkdirSync(path.join(root, "content", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "content", "posts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "content", "pages", "ok.mdx"),
      "---\ntitle: Ok Page\nupdated: 2026-03-04\n---\n\n# Section\n\nBody text here.\n",
    );
    fs.writeFileSync(
      path.join(root, "content", "pages", "secret.mdx"),
      "---\ntitle: Secret\ndraft: true\n---\n\nHidden body.\n",
    );
    fs.writeFileSync(path.join(root, "content", "pages", "broken.mdx"), "---\ndraft: false\n---\n\nNo title.\n");
    fs.writeFileSync(
      path.join(root, "content", "posts", "hello.mdx"),
      "---\ntitle: Hello\ndate: 2026-01-02\n---\n\nPost body.\n",
    );

    const { routes, searchIndex, warnings, fileCount } = buildContentIndexes(root);

    assert.equal(fileCount, 4);
    assert.deepEqual(
      routes.map((r) => r.routePath).sort(),
      ["/blog/hello", "/ok", "/secret"],
    );
    assert.deepEqual(searchIndex.map((i) => i.routePath).sort(), ["/blog/hello", "/ok"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /broken\.mdx/);
    assert.match(warnings[0], /title is required/);

    const page = routes.find((r) => r.routePath === "/ok");
    assert.equal(page.lastmod.slice(0, 10), "2026-03-04");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("content index: an empty result with content present is a build failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-empty-"));
  try {
    fs.mkdirSync(path.join(root, "content", "posts"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "posts", "bad.mdx"), "---\n---\n\nNothing.\n");

    const { routes, warnings, fileCount } = buildContentIndexes(root);
    assert.equal(fileCount, 1);
    assert.equal(routes.length, 0);
    assert.equal(warnings.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("content index: password-protected routes stay out of the search index", () => {
  const protectedPrefixes = readProtectedPrefixes();
  assert.ok(protectedPrefixes.length > 0, "expected a protected-route rule to exercise this");

  const { routes, searchIndex } = buildContentIndexes(REPO_ROOT);
  const covered = routes.filter((r) => !r.draft && isProtected(r.routePath, protectedPrefixes));
  assert.ok(covered.length > 0, "expected a published page behind a password rule");

  for (const route of covered) {
    const leaked = searchIndex.find((item) => item.routePath === route.routePath);
    assert.equal(leaked, undefined, `protected route is publicly searchable: ${route.routePath}`);
  }
});

test("content index: pages index the components they embed", () => {
  const { searchIndex } = buildContentIndexes(REPO_ROOT);
  const byRoute = new Map(searchIndex.map((item) => [item.routePath, item]));

  // `content/pages/{news,publications,works}.mdx` are thin wrappers around a
  // `<XxxBlock />`; without following the embed these pages index as empty and
  // nothing in them is findable.
  for (const [routePath, needle] of [
    ["/news", "reviewer"],
    ["/publications", "AAAI"],
    ["/works", "Instructor"],
    ["/teaching", "CSCI"],
  ]) {
    const item = byRoute.get(routePath);
    assert.ok(item, `search index is missing ${routePath}`);
    assert.ok(item.text.length > 400, `${routePath} has almost no indexed text (${item.text.length})`);
    assert.ok(item.text.includes(needle), `${routePath} body text is missing "${needle}"`);
  }
});

test("content index: every registered embed tag resolves to its component source", () => {
  // The generator maps `<XxxBlock />` to `content/components/xxx.mdx` by
  // convention. If the registry ever breaks that convention the page silently
  // loses its whole body from the index, so pin the two together here.
  for (const definition of SITE_COMPONENT_DEFINITIONS) {
    const derived = definition.embedTag.replace(/Block$/, "").toLowerCase();
    assert.equal(
      `content/components/${derived}.mdx`,
      definition.sourcePath,
      `<${definition.embedTag} /> does not resolve to ${definition.sourcePath}`,
    );
    assert.ok(fs.statSync(path.join(REPO_ROOT, definition.sourcePath)).isFile());
  }
});

test("content index: JSX prop text survives tag stripping", () => {
  const { text } = extractSearchFieldsFromMdx(
    [
      '<WorksEntry role="Part-time Instructor" affiliation="Orange Education Ltd" affiliationUrl="https://example.com/x" period="Sep 2019 - Now">',
      "",
      "Body prose.",
      "",
      "</WorksEntry>",
      "",
      `<PublicationsEntry data='{"title":"Long-form evaluation","year":"2024","url":"https://example.com/p","venues":[{"type":"conference","text":"NAACL"}]}' />`,
      "",
      '<span data-link-style="icon">[Scholar](https://example.com)</span>',
    ].join("\n"),
  );

  assert.match(text, /Part-time Instructor/);
  assert.match(text, /Sep 2019 - Now/);
  assert.match(text, /Long-form evaluation/);
  assert.match(text, /NAACL/);
  assert.match(text, /Scholar/);
  // URLs and plumbing props are noise in a search body.
  assert.doesNotMatch(text, /example\.com/);
  assert.doesNotMatch(text, /icon/);
});

test("content index: MDX text extraction drops code fences and keeps headings", () => {
  const { headings, text } = extractSearchFieldsFromMdx(
    [
      "# Title One",
      "",
      "Some **bold** prose with a [link](https://example.com).",
      "",
      "```js",
      "const secret = 1;",
      "```",
      "",
      "## Title Two",
      "",
      "- list item",
    ].join("\n"),
  );

  assert.deepEqual(headings, ["Title One", "Title Two"]);
  assert.match(text, /Some bold prose with a link\./);
  assert.match(text, /list item/);
  assert.doesNotMatch(text, /const secret/);
});
