import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { pickStaticProtectedRule } from "../../cloudflare/static-shell-protection.mjs";
import { isInternalStaticAssetPath } from "../../cloudflare/worker-entry-guards.mjs";
import { publishableProtectedPolicy } from "../../scripts/build/export-static-shell-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const POLICY = {
  rules: [
    {
      id: "csci3141",
      key: "path",
      mode: "prefix",
      auth: "password",
      path: "/teaching/archive/2024-25-fall/csci3141",
      pageId: "",
      token: "a".repeat(64),
    },
  ],
  routesMap: {},
  parentByPageId: {},
};

test("static shell export skips every route covered by a protected rule", () => {
  // These are the exact routes that leaked in production: the rule is a prefix
  // rule, so the rule path itself and everything beneath it must be excluded.
  const protectedRoutes = [
    "/teaching/archive/2024-25-fall/csci3141",
    "/teaching/archive/2024-25-fall/csci3141/syllabus",
  ];
  for (const route of protectedRoutes) {
    assert.ok(
      pickStaticProtectedRule(route, POLICY),
      `${route} must be recognised as protected by the export filter`,
    );
  }

  // Sibling and parent routes stay exportable, otherwise the CPU mitigation dies.
  for (const route of ["/teaching", "/teaching/archive", "/blog", "/"]) {
    assert.equal(
      pickStaticProtectedRule(route, POLICY),
      null,
      `${route} must remain exportable`,
    );
  }
});

test("published protection policy never carries the stored password verifier", () => {
  const published = publishableProtectedPolicy(POLICY);

  assert.equal(published.rules.length, 1);
  assert.equal(
    Object.hasOwn(published.rules[0], "token"),
    false,
    "rule.token is the stored verifier and must not reach a public asset",
  );
  // Everything the Worker actually consumes must survive the strip.
  assert.equal(published.rules[0].id, "csci3141");
  assert.equal(published.rules[0].auth, "password");
  assert.equal(published.rules[0].mode, "prefix");
  assert.equal(published.rules[0].path, "/teaching/archive/2024-25-fall/csci3141");

  assert.equal(
    JSON.stringify(published).includes("a".repeat(64)),
    false,
    "serialized policy must not contain the verifier anywhere",
  );
});

test("the internal /__static key space is not addressable from outside", () => {
  for (const pathname of [
    "/__static",
    "/__static/",
    "/__static/index.html",
    "/__static/teaching/archive/2024-25-fall/csci3141",
    "/__static/protected-routes-policy.json",
  ]) {
    assert.equal(
      isInternalStaticAssetPath(pathname),
      true,
      `${pathname} must be rejected by the Worker`,
    );
  }

  for (const pathname of ["/", "/blog", "/__staticfoo", "/teaching/__static"]) {
    assert.equal(
      isInternalStaticAssetPath(pathname),
      false,
      `${pathname} must not be treated as internal`,
    );
  }
});

test("wrangler routes /__static/* through the Worker instead of the asset server", () => {
  const wrangler = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8");
  const assetsBlock = wrangler.slice(wrangler.indexOf("[assets]"));
  const runWorkerFirst = /run_worker_first\s*=\s*\[([^\]]*)\]/.exec(assetsBlock);

  assert.ok(
    runWorkerFirst,
    "[assets] must set run_worker_first, or the asset server answers /__static/* before the Worker runs",
  );
  assert.match(runWorkerFirst[1], /"\/__static\/\*"/);
});

test("password-protected routes stay out of the public sitemap and search index", () => {
  const routes = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "content/generated/content-routes.json"), "utf8"),
  );
  const search = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "content/generated/search-index.json"), "utf8"),
  );
  const rules = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "content/filesystem/protected-routes.json"), "utf8"),
  );
  const policy = { rules, routesMap: {}, parentByPageId: {} };

  // Before the sitemap was repaired it was empty, which hid this: a working
  // sitemap would have started advertising the password gate to crawlers.
  for (const row of Array.isArray(routes) ? routes : []) {
    if (!pickStaticProtectedRule(row.routePath, policy)) continue;
    assert.equal(
      row.protected,
      true,
      `${row.routePath} matches a protected rule but is not flagged in content-routes.json`,
    );
  }

  const searchRoutes = new Set(
    (Array.isArray(search) ? search : []).map((item) => item.routePath),
  );
  for (const row of Array.isArray(routes) ? routes : []) {
    if (!row.protected) continue;
    assert.equal(
      searchRoutes.has(row.routePath),
      false,
      `${row.routePath} is protected but appears in the public search index`,
    );
  }

  // The repo genuinely has one such rule today; if that stops being true this
  // test silently stops testing anything.
  assert.ok(
    (Array.isArray(routes) ? routes : []).some((row) => row.protected),
    "expected at least one protected route in the fixture content",
  );
});
