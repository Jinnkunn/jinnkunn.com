import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CLASSIC_LAYOUT = path.join(ROOT, "app", "(classic)", "layout.tsx");
const CLASSIC_CSS = path.join(ROOT, "app", "(classic)", "classic.css");

const EXPECTED_LAYOUT_IMPORTS = [
  "classic.css",
  "design-system-bridge.css",
  "search.css",
  "toc.css",
  "lightbox.css",
  "publications.css",
  "blog-index.css",
  "news.css",
  "teaching.css",
  "works.css",
  "home.css",
  "posts-mdx.css",
  "page-overrides.css",
  "notion-blocks.css",
  "navigation.css",
  "runtime-polish.css",
];

const EXPECTED_CLASSIC_IMPORTS = [
  "../../public/styles/super-inline.css",
  "katex/dist/katex.min.css",
  "../../public/styles/static.css",
  "../../public/styles/notion.css",
  "../../public/styles/super.css",
  "../../public/styles/super-nav.css",
];

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function extractSideEffectCssImports(source) {
  return Array.from(source.matchAll(/import\s+["']\.\/([^"']+\.css)["'];/g)).map(
    (match) => match[1],
  );
}

function extractCssImports(source) {
  return Array.from(source.matchAll(/@import\s+["']([^"']+)["'];/g)).map(
    (match) => match[1],
  );
}

function assertExactOrder(actual, expected, label) {
  assert(actual.length === expected.length, `${label} import count drifted`, {
    actual,
    expected,
  });
  expected.forEach((item, index) => {
    assert(actual[index] === item, `${label} import order drifted`, {
      index,
      actual,
      expected,
    });
  });
}

function main() {
  const layoutImports = extractSideEffectCssImports(read(CLASSIC_LAYOUT));
  assertExactOrder(layoutImports, EXPECTED_LAYOUT_IMPORTS, "Classic layout CSS");

  const classicImports = extractCssImports(read(CLASSIC_CSS));
  assertExactOrder(classicImports, EXPECTED_CLASSIC_IMPORTS, "Classic base CSS");

  assert(
    layoutImports.indexOf("page-overrides.css") > layoutImports.indexOf("home.css") &&
      layoutImports.indexOf("page-overrides.css") > layoutImports.indexOf("works.css"),
    "page-overrides.css must stay after page-specific CSS",
    { layoutImports },
  );
  assert(
    layoutImports.at(-1) === "runtime-polish.css",
    "runtime-polish.css must stay as the final classic CSS layer",
    { layoutImports },
  );

  console.log("[classic-css-boundary-check] passed");
}

main();
