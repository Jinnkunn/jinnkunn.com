#!/usr/bin/env node
// Materialize every row in D1 `content_files` back onto the local filesystem
// so the existing build-time reading layer (lib/posts/, lib/pages/, etc.)
// works unchanged when SITE_ADMIN_STORAGE="db".
//
// Idempotent: a path whose disk bytes already equal the DB body is skipped.
// Read-only with respect to the DB; writes only to --target (default ./content).
//
// Body bytes are pulled as `lower(hex(body))` because wrangler's --json output
// is JSON text, so binary needs an envelope. Hex doubles the payload but
// there's no escaping/binary-in-JSON ambiguity, and our largest body (~62 KB)
// is well within the per-query response budget after doubling.
//
// Usage:
//   node scripts/dump-content-from-db.mjs --local
//   node scripts/dump-content-from-db.mjs --remote
//   node scripts/dump-content-from-db.mjs --remote --env=staging
//   node scripts/dump-content-from-db.mjs --remote --env=production
//   node scripts/dump-content-from-db.mjs --local --target=/tmp/dump-out

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BINDING = "SITE_ADMIN_DB";
const DEFAULT_TARGET = path.join(ROOT, "content");
const ALLOWED_PASSTHROUGH = new Set(["--local", "--remote", "--preview"]);

function parseArgs() {
  const out = {
    passthrough: [],
    target: DEFAULT_TARGET,
    quiet: false,
    // Read-only mode: don't write anywhere. Just compare each D1 row's
    // body against the on-disk file at <target>/<rel_path> and emit a
    // summary of which paths are added / modified / removed. Useful as
    // a fast "is my staging D1 still in sync with main?" check between
    // daily auto-snapshots without re-running a full deploy.
    diffOnly: false,
    // Machine-readable output mode. Pairs naturally with --diff-only —
    // a wrapper (cron, daily snapshot CI step) can parse the JSON to
    // decide whether a sync PR is worth opening, instead of grepping
    // human-formatted lines that may shift over time.
    json: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--target=")) out.target = path.resolve(arg.slice(9));
    else if (arg === "--quiet") out.quiet = true;
    else if (arg === "--diff-only") out.diffOnly = true;
    else if (arg === "--json") out.json = true;
    else if (arg.startsWith("--env=")) out.passthrough.push(arg);
    else if (ALLOWED_PASSTHROUGH.has(arg)) out.passthrough.push(arg);
    else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/dump-content-from-db.mjs [--local|--remote] [--env=staging|production] [--target=PATH] [--quiet] [--diff-only] [--json]",
      );
      process.exit(2);
    }
  }
  return out;
}

function runWranglerCapture(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", args, { env: process.env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler exited ${code}\n${stderr}`));
    });
    proc.on("error", reject);
  });
}

function extractJsonArray(stdout) {
  // wrangler prefixes its JSON response with banner / status lines. The
  // payload always starts with `[` and runs to the end of stdout, so locate
  // the first `[` after a newline (banner + horizontal rule live above it).
  const idx = stdout.indexOf("[");
  if (idx < 0) {
    throw new Error("wrangler returned no JSON payload");
  }
  return JSON.parse(stdout.slice(idx));
}

async function main() {
  const args = parseArgs();

  const stdout = await runWranglerCapture([
    "wrangler",
    "d1",
    "execute",
    BINDING,
    ...args.passthrough,
    "--command",
    "SELECT rel_path, lower(hex(body)) AS hex FROM content_files",
    "--json",
  ]);

  const payload = extractJsonArray(stdout);
  const rows = payload?.[0]?.results;
  if (!Array.isArray(rows)) {
    throw new Error(
      `unexpected wrangler payload shape: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }

  if (args.diffOnly) {
    return runDiffOnly(args, rows);
  }

  let written = 0;
  let skipped = 0;
  for (const row of rows) {
    const relPath = String(row.rel_path);
    const bytes = Buffer.from(String(row.hex), "hex");
    const fullPath = path.join(args.target, relPath);

    // Idempotent: only rewrite when content actually differs. Saves a write
    // round-trip and keeps mtimes stable for unchanged files (handy under
    // file-watch dev tooling).
    let existing = null;
    try {
      existing = await readFile(fullPath);
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
    if (existing && Buffer.compare(existing, bytes) === 0) {
      skipped += 1;
      continue;
    }

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes);
    written += 1;
    if (!args.quiet) console.log(`wrote ${relPath} (${bytes.byteLength}B)`);
  }
  console.log(
    `dump done: written=${written} skipped=${skipped} total=${rows.length}`,
  );
}

// `--diff-only` walks the same dump payload but writes nothing — instead
// it returns "what would change if I dumped". Used by the daily snapshot
// CI cron (decides whether to open a sync PR) and by operators who want
// a "is my D1 ahead of main?" answer between deploys.
async function runDiffOnly(args, rows) {
  const seenInDb = new Set();
  const added = [];
  const modified = [];
  const unchanged = [];

  for (const row of rows) {
    const relPath = String(row.rel_path);
    seenInDb.add(relPath);
    const bytes = Buffer.from(String(row.hex), "hex");
    const fullPath = path.join(args.target, relPath);
    let existing = null;
    try {
      existing = await readFile(fullPath);
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
    if (!existing) {
      added.push({ relPath, bytes: bytes.byteLength });
    } else if (Buffer.compare(existing, bytes) !== 0) {
      modified.push({
        relPath,
        oldBytes: existing.byteLength,
        newBytes: bytes.byteLength,
      });
    } else {
      unchanged.push(relPath);
    }
  }

  // Files in the working tree that D1 doesn't know about. Walking the
  // filesystem would over-report (caches, etc.); rely on `git ls-files`
  // so we only report tracked files. If git isn't available, skip
  // removed-detection rather than crash — the staging→git diff still
  // captures the more useful add/modify dimension.
  const removed = [];
  try {
    const tracked = await runGitLsFiles(args.target);
    for (const relPath of tracked) {
      if (seenInDb.has(relPath)) continue;
      // `content/generated/*` is build-time output, written by
      // scripts/prebuild.mjs and committed for production parity. It
      // is intentionally never in D1, so reporting it as "drift"
      // would be a false positive every single run.
      if (relPath.startsWith("generated/")) continue;
      removed.push({ relPath });
    }
  } catch {
    // git unavailable; leave `removed` empty
  }

  const result = {
    target: path.relative(ROOT, args.target),
    totalRowsInDb: rows.length,
    summary: {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      unchanged: unchanged.length,
    },
    added,
    modified,
    removed,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `[dump-content --diff-only] target=${result.target} total=${result.totalRowsInDb}`,
  );
  console.log(
    `  added=${result.summary.added} modified=${result.summary.modified} removed=${result.summary.removed} unchanged=${result.summary.unchanged}`,
  );
  for (const entry of added) {
    console.log(`  + ${entry.relPath}  (${entry.bytes}B)`);
  }
  for (const entry of modified) {
    console.log(
      `  ~ ${entry.relPath}  (${entry.oldBytes}B → ${entry.newBytes}B)`,
    );
  }
  for (const entry of removed) {
    console.log(`  - ${entry.relPath}  (in git, not in D1)`);
  }
}

function runGitLsFiles(target) {
  const relTarget = path.relative(ROOT, target) || ".";
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "--", relTarget],
      { cwd: ROOT, env: process.env },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      if (code !== 0) {
        return reject(new Error(`git ls-files exited ${code}: ${stderr}`));
      }
      const files = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        // git ls-files reports paths relative to repo root; the dump
        // wrote them as <relTarget>/<relPath>. Strip the prefix so we
        // can compare to D1's rel_path keys.
        .map((line) =>
          relTarget === "."
            ? line
            : line.startsWith(`${relTarget}/`)
              ? line.slice(relTarget.length + 1)
              : line,
        );
      resolve(files);
    });
    proc.on("error", reject);
  });
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
