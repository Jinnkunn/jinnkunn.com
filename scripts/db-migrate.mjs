#!/usr/bin/env node
// Apply every SQL file under ./migrations to the configured D1 database via
// `wrangler d1 execute`. Idempotent — migrations use `CREATE … IF NOT EXISTS`,
// so re-running is safe.
//
// Usage:
//   node scripts/db-migrate.mjs --local                    # local D1 (dev)
//   node scripts/db-migrate.mjs --remote --env=staging
//   node scripts/db-migrate.mjs --remote --env=production
//
// `--local`, `--remote`, `--env=…`, and `--preview` are passed straight through
// to wrangler. Any other flag is rejected so typos don't silently target the
// wrong DB.

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const BINDING = "SITE_ADMIN_DB";
const ALLOWED_PASSTHROUGH = new Set(["--local", "--remote", "--preview"]);

function parseArgs() {
  const passthrough = [];
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env=")) passthrough.push(arg);
    else if (ALLOWED_PASSTHROUGH.has(arg)) passthrough.push(arg);
    else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/db-migrate.mjs [--local|--remote] [--env=staging|production]",
      );
      process.exit(2);
    }
  }
  return { passthrough };
}

function runNpx(args) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`> npx ${args.join(" ")}\n`);
    const proc = spawn("npx", args, { stdio: "inherit", env: process.env });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function main() {
  const { passthrough } = parseArgs();
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log("no migrations directory found");
      return;
    }
    throw err;
  }
  const files = entries.filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("no migrations found");
    return;
  }

  for (const file of files) {
    await runNpx([
      "wrangler",
      "d1",
      "execute",
      BINDING,
      ...passthrough,
      "--file",
      path.join("migrations", file),
    ]);
  }
  console.log(`applied ${files.length} migration(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
