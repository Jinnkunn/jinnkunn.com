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
  const out = { passthrough: [], target: DEFAULT_TARGET, quiet: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--target=")) out.target = path.resolve(arg.slice(9));
    else if (arg === "--quiet") out.quiet = true;
    else if (arg.startsWith("--env=")) out.passthrough.push(arg);
    else if (ALLOWED_PASSTHROUGH.has(arg)) out.passthrough.push(arg);
    else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/dump-content-from-db.mjs [--local|--remote] [--env=staging|production] [--target=PATH] [--quiet]",
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

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
