import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const COLOR_LITERAL_RE = /\brgba?\(|\bhsla?\(|#[0-9A-Fa-f]{3,8}\b/;
const ROUTE_OVERRIDE_FILES = [
  "app/globals.css",
  "app/state-pages.css",
  "app/(classic)/navigation.css",
  "app/(classic)/search.css",
  "app/(classic)/toc.css",
  "app/(classic)/lightbox.css",
  "app/(classic)/publications.css",
  "app/(classic)/sitemap/sitemap.module.css",
  "app/(classic)/site-admin/styles/config.css",
  "app/(classic)/site-admin/styles/status.css",
  "app/(classic)/site-admin/styles/routes/base.css",
  "app/(classic)/site-admin/styles/routes/tree.css",
  "app/(classic)/site-admin/styles/routes/table.css",
  "app/(classic)/site-admin/styles/routes/admin.css",
  "public/styles/static.css",
  "lib/client/nav/menu-animation.ts",
  "app/site.webmanifest/route.ts",
];

test("design-system-route-overrides: route-scoped overrides rely on tokens instead of raw colors", async () => {
  const violations = [];

  for (const relFile of ROUTE_OVERRIDE_FILES) {
    const source = await fs.readFile(path.join(ROOT, relFile), "utf8");
    if (COLOR_LITERAL_RE.test(source)) violations.push(relFile);
  }

  assert.deepEqual(violations, []);
});
