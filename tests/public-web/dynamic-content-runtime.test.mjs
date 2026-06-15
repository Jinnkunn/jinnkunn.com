import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("public posts and pages read through ContentStore wrappers", async () => {
  const [postsIndex, pagesIndex, publicationsPage] = await Promise.all([
    source("lib/posts/index.ts"),
    source("lib/pages/index.ts"),
    source("app/(classic)/publications/page.tsx"),
  ]);

  assert.match(postsIndex, /from "\.\/store"/);
  assert.doesNotMatch(postsIndex, /node:fs|readFile|readdir|stat|process\.cwd\(\)/);

  assert.match(pagesIndex, /from "\.\/store"/);
  assert.doesNotMatch(pagesIndex, /node:fs|readFile|readdir|stat|process\.cwd\(\)/);

  assert.match(publicationsPage, /readComponent\("publications"\)/);
  assert.doesNotMatch(publicationsPage, /node:fs|readFile|process\.cwd\(\)/);
});

test("content-managed public routes render dynamically", async () => {
  const routes = [
    "app/(classic)/page.tsx",
    "app/(classic)/blog/page.tsx",
    "app/(classic)/blog/[slug]/page.tsx",
    "app/(classic)/[...slug]/page.tsx",
    "app/(classic)/pages/[...slug]/page.tsx",
    "app/(classic)/publications/page.tsx",
  ];
  const files = await Promise.all(routes.map(source));
  for (let index = 0; index < routes.length; index += 1) {
    const file = files[index];
    assert.match(file, /export const dynamic = "force-dynamic"/, routes[index]);
    assert.doesNotMatch(file, /export const dynamic = "force-static"/, routes[index]);
  }
});

test("Cloudflare worker bypasses static shell for runtime content routes", async () => {
  const worker = await source("cloudflare/worker-entry.mjs");
  assert.match(worker, /function isRuntimeContentRoute/);
  assert.match(worker, /pathname === "\/"/);
  assert.match(worker, /pathname === "\/blog" \|\| pathname\.startsWith\("\/blog\/"\)/);
  assert.match(worker, /pathname\.startsWith\("\/pages\/"\)/);
  assert.match(worker, /if \(isRuntimeContentRoute\(pathname\)\) return true/);
});

test("Cloudflare build patches OpenNext runtime manifest dynamic require", async () => {
  const [pkg, patcher] = await Promise.all([
    source("package.json").then((text) => JSON.parse(text)),
    source("scripts/build/patch-opennext-runtime-manifests.mjs"),
  ]);

  assert.match(pkg.scripts["build:cf"], /patch-opennext-runtime-manifests\.mjs/);
  assert.match(patcher, /middleware-manifest\.json/);
  assert.match(patcher, /open-next-runtime-manifest-guard/);
  assert.match(patcher, /Dynamic require of/);
});
