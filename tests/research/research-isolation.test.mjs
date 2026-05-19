import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESEARCH_MARKERS = [
  "release-agent-benchmark",
  "releaseAgentBenchmark",
  "Guarded Agentic Release benchmark",
];
const FORBIDDEN_PRODUCT_ROOTS = [
  "app",
  "apps",
  "cloudflare",
  "components",
  "lib",
  "scripts/release",
  "tests/release",
];
const RESEARCH_SCRIPT_ROOT = path.join(ROOT, "scripts", "research");
const SKIPPED_DIRS = new Set([
  ".next",
  ".turbo",
  "DerivedData",
  "build",
  "dist",
  "node_modules",
  "output",
  "target",
]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);
const ALLOWED_RESEARCH_IMPORTS = new Set(["../_lib/release-live-status.mjs"]);
const ALLOWED_FETCH_FILES = new Set(["scripts/research/providers/deepseek.mjs"]);
const ALLOWED_ARTIFACT_WRITER_FILES = new Set([
  "scripts/research/release-agent-benchmark-failure-analysis.mjs",
  "scripts/research/release-agent-benchmark-experiments.mjs",
]);
const FORBIDDEN_RESEARCH_CAPABILITIES = [
  { allowedFiles: ALLOWED_FETCH_FILES, name: "network fetch", pattern: /\bfetch\s*\(/ },
  { name: "child process spawn", pattern: /\bspawn(?:Sync)?\s*\(/ },
  { name: "child process exec", pattern: /\bexec(?:File|FileSync|Sync)?\s*\(/ },
  {
    allowedFiles: ALLOWED_ARTIFACT_WRITER_FILES,
    name: "file write",
    pattern: /\bwriteFile(?:Sync)?\s*\(/,
  },
  { name: "file append", pattern: /\bappendFile(?:Sync)?\s*\(/ },
  {
    allowedFiles: ALLOWED_ARTIFACT_WRITER_FILES,
    name: "directory create",
    pattern: /\bmkdir(?:Sync)?\s*\(/,
  },
  { name: "file remove", pattern: /\brm(?:Sync)?\s*\(/ },
  { name: "Cloudflare runtime", pattern: /\bgetCloudflareContext\b/ },
  { name: "wrangler", pattern: /\bwrangler\b/ },
];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(file));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(file);
    }
  }
  return out;
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file);
}

function packageJson() {
  return JSON.parse(readText(path.join(ROOT, "package.json")));
}

test("research isolation: release-agent benchmark entrypoint stays outside release scripts", () => {
  const scripts = packageJson().scripts || {};
  assert.equal(
    scripts["benchmark:release-agent"],
    "node scripts/research/release-agent-benchmark.mjs",
  );
  assert.equal(
    scripts["benchmark:release-agent:experiments"],
    "node scripts/research/release-agent-benchmark-experiments.mjs",
  );
  assert.equal(
    scripts["benchmark:release-agent:analyze"],
    "node scripts/research/release-agent-benchmark-failure-analysis.mjs",
  );
  assert.equal(
    scripts["benchmark:release-agent:coverage"],
    "node scripts/research/release-agent-benchmark-coverage.mjs",
  );
  assert.equal(
    scripts["paper:research:check"],
    "node scripts/research/release-agent-paper-check.mjs",
  );
});

test("research isolation: product and release roots do not reference benchmark research code", () => {
  const offenders = [];
  for (const root of FORBIDDEN_PRODUCT_ROOTS) {
    for (const file of walkFiles(path.join(ROOT, root))) {
      const text = readText(file);
      if (RESEARCH_MARKERS.some((marker) => text.includes(marker))) {
        offenders.push(rel(file));
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("research isolation: scripts/research has no side-effectful runtime capabilities", () => {
  const offenders = [];
  for (const file of walkFiles(RESEARCH_SCRIPT_ROOT)) {
    const relativeFile = rel(file);
    const text = readText(file);
    for (const capability of FORBIDDEN_RESEARCH_CAPABILITIES) {
      if (!capability.pattern.test(text)) continue;
      if (capability.allowedFiles?.has(relativeFile)) continue;
      offenders.push(`${relativeFile} matches ${capability.name}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("research isolation: scripts/research imports only explicit pure release helper", () => {
  const offenders = [];
  const importPattern = /^\s*import\s+.*?\s+from\s+["']([^"']+)["']/gm;
  for (const file of walkFiles(RESEARCH_SCRIPT_ROOT)) {
    const text = readText(file);
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      if (specifier.startsWith("./")) continue;
      if (ALLOWED_RESEARCH_IMPORTS.has(specifier)) continue;
      offenders.push(`${rel(file)} imports ${specifier}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("research isolation: repeat-run artifact writer is constrained to output/research", () => {
  const experimentRunner = readText(
    path.join(ROOT, "scripts", "research", "release-agent-benchmark-experiments.mjs"),
  );
  const failureAnalyzer = readText(
    path.join(ROOT, "scripts", "research", "release-agent-benchmark-failure-analysis.mjs"),
  );

  assert.match(experimentRunner, /OUTPUT_RESEARCH_DIR/);
  assert.match(experimentRunner, /"output", "research"/);
  assert.match(experimentRunner, /Experiment artifacts must be written under output\/research/);
  assert.match(failureAnalyzer, /OUTPUT_RESEARCH_DIR/);
  assert.match(failureAnalyzer, /"output", "research"/);
  assert.match(failureAnalyzer, /Failure analysis output/);
  assert.match(failureAnalyzer, /under output\/research/);
});
