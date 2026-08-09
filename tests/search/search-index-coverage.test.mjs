import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { registerNextModuleHooks } from "../helpers/next-module-hooks.mjs";

const REPO_ROOT = registerNextModuleHooks();

// Same trick as the sitemap tests: an empty cwd is what the Worker sees, so
// only the statically imported `search-index.json` can satisfy these.
const EMPTY_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "search-worker-cwd-"));
const originalCwd = process.cwd();
process.chdir(EMPTY_CWD);

process.on("exit", () => {
  process.chdir(originalCwd);
  fs.rmSync(EMPTY_CWD, { recursive: true, force: true });
});

const { getSearchIndex } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/search-index.ts")).href
);
const { getRoutesManifest } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/routes-manifest.ts")).href
);
const { isIgnoredPath } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/search/api-model.ts")).href
);
const { buildSearchResponse } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/search/api-service.ts")).href
);

const contentRoutes = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "content", "generated", "content-routes.json"), "utf8"),
);

const { getProtectedRoutes } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/protected-routes.ts")).href
);
const { findProtectedMatch } = await import(
  pathToFileURL(path.join(REPO_ROOT, "lib/routes/strategy.ts")).href
);
const protectedRules = getProtectedRoutes();

function isProtected(routePath) {
  return Boolean(findProtectedMatch(routePath, protectedRules));
}

function search(q) {
  return buildSearchResponse({
    q,
    type: "all",
    offset: 0,
    limit: 20,
    scope: "",
    index: getSearchIndex().filter((it) => !isIgnoredPath(it.routePath)),
    manifest: getRoutesManifest().filter((it) => !isIgnoredPath(it.routePath)),
    includeSnippets: true,
  });
}

test("search index: covers every published slug", () => {
  const indexed = new Set(getSearchIndex().map((item) => item.routePath));
  const published = contentRoutes.filter((row) => !row.draft);

  assert.ok(published.length >= 20, `expected 20+ published routes, got ${published.length}`);
  for (const row of published) {
    if (isProtected(row.routePath)) continue;
    assert.ok(indexed.has(row.routePath), `search index is missing ${row.routePath}`);
  }
  for (const row of contentRoutes.filter((r) => r.draft)) {
    assert.equal(indexed.has(row.routePath), false, `draft is searchable: ${row.routePath}`);
  }
});

test("search index: password-protected pages are not publicly searchable", () => {
  const gated = contentRoutes.filter((row) => !row.draft && isProtected(row.routePath));
  assert.ok(gated.length > 0, "expected a published page behind a password rule");

  for (const row of gated) {
    assert.equal(
      getSearchIndex().some((item) => item.routePath === row.routePath),
      false,
      `protected page is in the public index: ${row.routePath}`,
    );
    // The gate is worthless if `/api/search` hands the body back anyway.
    const paths = search(row.title).items.map((item) => item.routePath);
    assert.equal(paths.includes(row.routePath), false, `protected page is returned by search: ${row.title}`);
  }
});

test("search index: data-driven pages carry the text their components render", () => {
  const byRoute = new Map(getSearchIndex().map((item) => [item.routePath, item]));
  for (const routePath of ["/news", "/publications", "/works", "/teaching"]) {
    const item = byRoute.get(routePath);
    assert.ok(item, `search index is missing ${routePath}`);
    assert.ok(item.text.length > 400, `${routePath} indexes as near-empty (${item.text.length} chars)`);
  }

  // A publication title only exists inside `<PublicationsEntry data='…' />`.
  const paths = search("Long-form evaluation of model editing").items.map((item) => item.routePath);
  assert.ok(paths.includes("/publications"), `publications not findable by entry title: ${paths.join(", ")}`);
});

test("search index: carries body text, not just titles", () => {
  const withText = getSearchIndex().filter((item) => item.text.length > 200);
  assert.ok(withText.length >= 15, `expected most entries to carry text, got ${withText.length}`);
});

test("search index: every published post is findable by its title", () => {
  const posts = contentRoutes.filter((row) => row.kind === "post" && !row.draft);
  assert.ok(posts.length >= 8);

  for (const post of posts) {
    const response = search(post.title);
    const paths = response.items.map((item) => item.routePath);
    assert.equal(paths[0], post.routePath, `expected ${post.routePath} to rank first for its own title`);
  }
});

test("search index: results are not duplicated by stale routes-manifest rows", () => {
  const response = search("reasoning drift");
  const paths = response.items.map((item) => item.routePath);
  assert.equal(new Set(paths).size, paths.length, `duplicate results: ${paths.join(", ")}`);
  for (const routePath of paths) {
    assert.doesNotMatch(routePath, /^\/blog\/list\//, "legacy /blog/list route leaked into search");
  }
});
