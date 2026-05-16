import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "public", "styles"),
];

const EXCEPTION_FILES = new Set([
  "app/design-system.css",
  "app/(classic)/notion-blocks.css",
  "public/styles/notion.css",
]);
const EXCEPTION_PREFIXES = ["public/styles/super"];

const COLOR_LITERAL_RE = /\brgba?\([^)]*\)|\bhsla?\([^)]*\)|#[0-9A-Fa-f]{3,8}\b/g;

function rel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, "/");
}

function walk(dirAbs, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (entry.isFile() && abs.endsWith(".css")) out.push(abs);
  }
}

function shouldSkip(relPath) {
  if (EXCEPTION_FILES.has(relPath)) return true;
  return EXCEPTION_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function collectColorLiteralViolations(source, relPath) {
  const lines = source.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!COLOR_LITERAL_RE.test(line)) continue;
    COLOR_LITERAL_RE.lastIndex = 0;
    out.push({
      file: relPath,
      line: i + 1,
      snippet: line.trim(),
    });
  }

  return out;
}

function main() {
  const cssFiles = [];
  for (const targetDir of TARGET_DIRS) walk(targetDir, cssFiles);

  cssFiles.sort((a, b) => a.localeCompare(b));

  const scanned = [];
  const violations = [];

  for (const absFile of cssFiles) {
    const relFile = rel(absFile);
    if (shouldSkip(relFile)) continue;
    scanned.push(relFile);

    const source = fs.readFileSync(absFile, "utf8");
    violations.push(...collectColorLiteralViolations(source, relFile));
  }

  if (violations.length > 0) {
    console.error("[design-system] Core surface color literal violations detected:");
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line}`);
      console.error(`  ${violation.snippet}`);
    }
    console.error(
      "\nOnly documented compatibility exceptions may contain raw color literals:",
    );
    console.error(
      "- app/design-system.css, app/(classic)/notion-blocks.css, public/styles/notion.css, public/styles/super*.css",
    );
    process.exit(1);
  }

  console.log(`[design-system] Checked ${scanned.length} core-surface CSS files (OK).`);
}

main();
