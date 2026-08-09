import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

// Paths that must never reach a public repo: personal material that happens to
// live in the working tree, plus local build/tool junk. A single `git add -A`
// is all it takes to publish them.
const REQUIRED_IGNORE_PATTERNS = [
  "/_purdue_materials/",
  "/.playwright-cli/",
  "/output/",
  "/.cache/",
  "/.tmp/",
  "*.tsbuildinfo",
  ".DS_Store",
  "*.pem",
  ".env*",
];

// Sample paths under the rules above, used for the git-backed assertion.
const REQUIRED_IGNORED_PATHS = [
  "_purdue_materials/resume.pdf",
  ".playwright-cli/browser.json",
  "output/report.html",
  "tsconfig.tsbuildinfo",
  ".DS_Store",
];

function readGitignoreLines() {
  const raw = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// Release snapshots run this suite from a copy of the tree without `.git`.
function hasGitDir() {
  return fs.existsSync(path.join(ROOT, ".git"));
}

test("repo-hygiene: .gitignore covers sensitive and junk paths", () => {
  const lines = new Set(readGitignoreLines());
  const missing = REQUIRED_IGNORE_PATTERNS.filter((pattern) => !lines.has(pattern));
  assert.deepEqual(missing, []);
});

test("repo-hygiene: ignore rules come from .gitignore, not a local exclude file", (t) => {
  if (!hasGitDir()) {
    t.skip("no .git directory (release snapshot copy)");
    return;
  }

  const notCoveredByGitignore = [];
  for (const target of REQUIRED_IGNORED_PATHS) {
    const res = spawnSync("git", ["check-ignore", "-v", "--no-index", target], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const source = String(res.stdout || "").split(":")[0];
    if (source !== ".gitignore") notCoveredByGitignore.push(`${target} -> ${source || "(not ignored)"}`);
  }

  assert.deepEqual(notCoveredByGitignore, []);
});

test("repo-hygiene: personal material is not tracked", (t) => {
  if (!hasGitDir()) {
    t.skip("no .git directory (release snapshot copy)");
    return;
  }

  const res = spawnSync("git", ["ls-files", "--", "_purdue_materials"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(String(res.stdout || "").trim(), "");
});

test("repo-hygiene: a dead-code detector is wired as an npm script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const command = pkg.scripts?.["check:dead-code"];
  assert.equal(typeof command, "string");
  assert.match(command, /knip|ts-prune/);
  assert.equal(fs.existsSync(path.join(ROOT, "knip.jsonc")), true);
});
