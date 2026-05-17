#!/usr/bin/env node
// Mirror D1 `content_files` rows from one environment to another.
//
// Staging remains the operator-editing source of truth. Production keeps a
// runtime mirror so production admin/mobile APIs can read the same content
// that was just promoted, without making production an editing target.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const BINDING = "SITE_ADMIN_DB";
const ALLOWED_PASSTHROUGH = new Set(["--remote", "--local", "--preview"]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: false,
    json: false,
    passthrough: ["--remote"],
    quiet: false,
    sourceEnv: "staging",
    targetEnv: "production",
  };
  let sawLocation = false;
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--quiet") out.quiet = true;
    else if (arg.startsWith("--source-env=")) out.sourceEnv = arg.slice("--source-env=".length);
    else if (arg.startsWith("--target-env=")) out.targetEnv = arg.slice("--target-env=".length);
    else if (ALLOWED_PASSTHROUGH.has(arg)) {
      if (arg === "--remote" || arg === "--local" || arg === "--preview") {
        if (sawLocation) out.passthrough = out.passthrough.filter((v) => !ALLOWED_PASSTHROUGH.has(v));
        sawLocation = true;
      }
      out.passthrough.push(arg);
    } else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/content/copy-content-db.mjs [--remote|--local] [--source-env=staging] [--target-env=production] [--dry-run] [--json] [--quiet]",
      );
      process.exit(2);
    }
  }
  out.sourceEnv = normalizeEnv(out.sourceEnv, "source-env");
  out.targetEnv = normalizeEnv(out.targetEnv, "target-env");
  if (out.sourceEnv === out.targetEnv) {
    console.error("--source-env and --target-env must be different");
    process.exit(2);
  }
  return out;
}

function normalizeEnv(value, label) {
  const raw = String(value || "").trim();
  if (raw === "staging" || raw === "production") return raw;
  console.error(`invalid --${label}: ${raw || "(empty)"}`);
  process.exit(2);
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
      else reject(new Error(`wrangler exited ${code}\n${stderr}${stdout}`));
    });
    proc.on("error", reject);
  });
}

function extractJsonArray(stdout) {
  const idx = stdout.indexOf("[");
  if (idx < 0) throw new Error("wrangler returned no JSON payload");
  return JSON.parse(stdout.slice(idx));
}

async function d1Query({ env, passthrough, sql }) {
  const stdout = await runWranglerCapture([
    "wrangler",
    "d1",
    "execute",
    BINDING,
    `--env=${env}`,
    ...passthrough,
    "--command",
    sql,
    "--json",
  ]);
  const payload = extractJsonArray(stdout);
  if (payload?.[0]?.success !== true) {
    throw new Error(`D1 query failed: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload?.[0]?.results ?? [];
}

async function d1ExecuteFile({ env, passthrough, file }) {
  const stdout = await runWranglerCapture([
    "wrangler",
    "d1",
    "execute",
    BINDING,
    `--env=${env}`,
    ...passthrough,
    "--file",
    file,
    "--json",
  ]);
  const payload = extractJsonArray(stdout);
  const failed = payload.find((entry) => entry?.success !== true);
  if (failed) {
    throw new Error(`D1 file execution failed: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(fallback);
}

function normalizeRow(row) {
  const relPath = String(row.rel_path || "");
  const bodyHex = String(row.body_hex || "");
  const sha = String(row.sha || "");
  if (!relPath || relPath.includes("\0")) throw new Error(`invalid rel_path: ${relPath}`);
  if (!/^[0-9a-f]*$/i.test(bodyHex)) throw new Error(`invalid body hex for ${relPath}`);
  if (!sha) throw new Error(`missing sha for ${relPath}`);
  return {
    relPath,
    bodyHex: bodyHex.toLowerCase(),
    isBinary: Number(row.is_binary || 0) ? 1 : 0,
    sha,
    size: Number(row.size || 0),
    updatedAt: Number(row.updated_at || Date.now()),
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
  };
}

function summarizeRows(rows) {
  let posts = 0;
  let pages = 0;
  for (const row of rows) {
    if (row.relPath.startsWith("posts/")) posts += 1;
    if (row.relPath.startsWith("pages/")) pages += 1;
  }
  return { rows: rows.length, posts, pages };
}

function buildMirrorSql(rows) {
  const lines = [
    "BEGIN TRANSACTION;",
    "DELETE FROM content_files;",
  ];
  for (const row of rows) {
    lines.push(
      `INSERT INTO content_files (rel_path, body, is_binary, sha, size, updated_at, updated_by) VALUES (${sqlText(row.relPath)}, X'${row.bodyHex}', ${row.isBinary}, ${sqlText(row.sha)}, ${sqlInt(row.size)}, ${sqlInt(row.updatedAt)}, ${sqlString(row.updatedBy)});`,
    );
  }
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs();
  const sourceRows = (
    await d1Query({
      env: args.sourceEnv,
      passthrough: args.passthrough,
      sql: `SELECT rel_path,
                   lower(hex(body)) AS body_hex,
                   is_binary,
                   sha,
                   size,
                   updated_at,
                   updated_by
              FROM content_files
             ORDER BY rel_path`,
    })
  ).map(normalizeRow);

  const summary = {
    ok: true,
    dryRun: args.dryRun,
    sourceEnv: args.sourceEnv,
    targetEnv: args.targetEnv,
    copied: args.dryRun ? 0 : sourceRows.length,
    source: summarizeRows(sourceRows),
  };

  if (!args.dryRun) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "content-db-copy-"));
    const sqlFile = path.join(tmpDir, "mirror-content-files.sql");
    try {
      await writeFile(sqlFile, buildMirrorSql(sourceRows));
      await d1ExecuteFile({
        env: args.targetEnv,
        passthrough: args.passthrough,
        file: sqlFile,
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (!args.quiet) {
    console.log(
      `[copy-content-db] ${args.dryRun ? "would copy" : "copied"} ${sourceRows.length} content_files rows ${args.sourceEnv} → ${args.targetEnv} (posts=${summary.source.posts}, pages=${summary.source.pages})`,
    );
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
