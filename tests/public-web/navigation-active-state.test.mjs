import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

test("navigation active state keeps Blog on the top-level item", async () => {
  const css = await fs.readFile(path.join(ROOT, "app/(classic)/navigation.css"), "utf8");

  assert.match(
    css,
    /\.super-root:has\(\.page__blog\) \.super-navbar__item\[href="\/blog"\]::after/,
  );
  assert.match(
    css,
    /\.super-root:has\(\.page__blog-post\) \.super-navbar__item\[href="\/blog"\]::after/,
  );
  assert.doesNotMatch(css, /\.super-root:has\(\.page__blog(?:-post)?\) \.super-navbar__list(?:::after)?/);
});

test("navigation and search behavior ship with the layout bundle", async () => {
  const source = await fs.readFile(
    path.join(ROOT, "components/site-nav-enhancers.tsx"),
    "utf8",
  );

  assert.match(source, /from "@\/lib\/client\/nav\/behavior-runtime"/);
  assert.match(source, /from "@\/lib\/client\/search\/behavior-runtime"/);
  assert.doesNotMatch(source, /import\("@\/lib\/client\/(?:nav|search)\/behavior-runtime"\)/);
  assert.match(source, /cleanupSearch\?\.\(\)/);
  assert.match(source, /cleanupNav\(\)/);
});

test("More uses click to open and hover only to keep an open menu stable", async () => {
  const source = await fs.readFile(
    path.join(ROOT, "lib/client/nav/menu-events.ts"),
    "utf8",
  );
  const pointerEnter = /const onMorePointerEnter = \(\) => \{([\s\S]*?)\n  \};/.exec(source)?.[1] || "";

  assert.match(pointerEnter, /clearMoreHoverClose\(\)/);
  assert.doesNotMatch(pointerEnter, /setMoreOpen\(true\)/);
  assert.match(source, /setMoreOpen\(!getMoreOpen\(\)\)/);
});
