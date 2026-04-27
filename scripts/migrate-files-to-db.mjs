#!/usr/bin/env node
// Generate UPSERT statements for every file under content/* and apply them to
// the configured D1 database via `wrangler d1 execute --file=…`.
//
// Idempotent: small files use ON CONFLICT to skip writes when the row's sha
// already matches. Large files (>BLOB_CHUNK_BYTES) take a chunked path that
// always rewrites; this is fine for a one-time / occasional content sync.
//
// Body bytes are inlined as SQLite hex literals (x'…') instead of bound
// parameters because D1's REST/wrangler params don't carry binary cleanly.
// Hex is `[0-9a-f]+` so there's no SQL-injection surface. D1 caps per-statement
// size at roughly 100 KB; we cap each chunk at 40 KB raw (= 80 KB hex) to stay
// under that with headroom for the surrounding SQL.
//
// Usage:
//   node scripts/migrate-files-to-db.mjs --local
//   node scripts/migrate-files-to-db.mjs --remote --env=staging
//   node scripts/migrate-files-to-db.mjs --remote --env=production
//   node scripts/migrate-files-to-db.mjs --local --root=/path/to/content

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BINDING = "SITE_ADMIN_DB";
const ACTOR = "migrate-files-to-db";
// Cap each statement's blob payload to keep the SQL under D1's per-statement
// size limit. 40 KB raw → 80 KB hex → ~80 KB statement, well below ~100 KB.
const BLOB_CHUNK_BYTES = 40 * 1024;

// Plain text. Anything else is stored with is_binary=1 so readBinary()
// round-trips faithfully. (The bytes themselves are stored in a BLOB column
// either way — the flag is purely metadata.)
const TEXT_EXTENSIONS = new Set([
  ".mdx",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".svg",
]);

// macOS / IDE noise + the auto-generated stubs that prebuild.mjs rewrites on
// every build — those don't belong in the content-of-record DB.
const SKIP_NAMES = new Set([".DS_Store", "generated"]);
const ALLOWED_PASSTHROUGH = new Set(["--local", "--remote", "--preview"]);

function parseArgs() {
  const out = {
    passthrough: [],
    root: path.join(ROOT, "content"),
    keep: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--root=")) out.root = path.resolve(arg.slice(7));
    else if (arg === "--keep-sql") out.keep = true;
    else if (arg.startsWith("--env=")) out.passthrough.push(arg);
    else if (ALLOWED_PASSTHROUGH.has(arg)) out.passthrough.push(arg);
    else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/migrate-files-to-db.mjs [--local|--remote] [--env=staging|production] [--root=PATH] [--keep-sql]",
      );
      process.exit(2);
    }
  }
  return out;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function isBinary(filePath) {
  return !TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function escapeSqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
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
  const args = parseArgs();
  const rootStat = await stat(args.root);
  if (!rootStat.isDirectory()) {
    console.error(`not a directory: ${args.root}`);
    process.exit(2);
  }

  const now = Date.now();
  const stmts = [];
  let count = 0;

  let chunkedCount = 0;
  for await (const filePath of walk(args.root)) {
    const relPath = path
      .relative(args.root, filePath)
      .split(path.sep)
      .join("/");
    const buf = await readFile(filePath);
    const bytes = new Uint8Array(buf);
    const sha = createHash("sha1").update(bytes).digest("hex");
    const binary = isBinary(filePath);
    const escRel = escapeSqlString(relPath);

    if (bytes.byteLength <= BLOB_CHUNK_BYTES) {
      // Small file: single UPSERT, idempotent via the sha-mismatch WHERE clause.
      stmts.push(
        `INSERT INTO content_files (rel_path, body, sha, size, is_binary, updated_at, updated_by)
VALUES (${escRel}, x'${bytesToHex(bytes)}', ${escapeSqlString(sha)}, ${bytes.byteLength}, ${binary ? 1 : 0}, ${now}, ${escapeSqlString(ACTOR)})
ON CONFLICT(rel_path) DO UPDATE SET
  body = excluded.body,
  sha = excluded.sha,
  size = excluded.size,
  is_binary = excluded.is_binary,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by
WHERE content_files.sha != excluded.sha;`,
      );
    } else {
      // Large file: split into hex chunks. SQLite's `||` operator on BLOBs
      // implicitly converts them to TEXT (treating bytes as UTF-8), which
      // corrupts arbitrary binary content. To stay binary-safe we accumulate
      // the *hex string* in body (TEXT, which || handles cleanly because hex
      // is pure ASCII) and decode it to a BLOB with unhex() in a final pass.
      chunkedCount += 1;
      stmts.push(`DELETE FROM content_files WHERE rel_path = ${escRel};`);
      const first = bytes.subarray(0, BLOB_CHUNK_BYTES);
      stmts.push(
        `INSERT INTO content_files (rel_path, body, sha, size, is_binary, updated_at, updated_by)
VALUES (${escRel}, ${escapeSqlString(bytesToHex(first))}, '', 0, ${binary ? 1 : 0}, ${now}, ${escapeSqlString(ACTOR)});`,
      );
      for (let off = BLOB_CHUNK_BYTES; off < bytes.byteLength; off += BLOB_CHUNK_BYTES) {
        const chunk = bytes.subarray(off, off + BLOB_CHUNK_BYTES);
        stmts.push(
          `UPDATE content_files SET body = body || ${escapeSqlString(bytesToHex(chunk))} WHERE rel_path = ${escRel};`,
        );
      }
      // Decode the accumulated hex to a real BLOB and stamp the consistent
      // sha + size in the same UPDATE so the row is never observed in a
      // mid-build state with the right sha but wrong body type.
      stmts.push(
        `UPDATE content_files SET body = unhex(body), sha = ${escapeSqlString(sha)}, size = ${bytes.byteLength} WHERE rel_path = ${escRel};`,
      );
    }
    count += 1;
  }

  if (count === 0) {
    console.log("no files found to import");
    return;
  }

  const tmpDir = path.join(ROOT, ".wrangler", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `migrate-files-${now}.sql`);
  await writeFile(tmpFile, stmts.join("\n\n") + "\n", "utf8");
  console.log(
    `generated ${stmts.length} statement(s) for ${count} file(s)` +
      (chunkedCount ? ` (${chunkedCount} chunked)` : "") +
      ` → ${path.relative(ROOT, tmpFile)} (${(
        stmts.join("").length /
        1024
      ).toFixed(1)} KB)`,
  );

  await runNpx([
    "wrangler",
    "d1",
    "execute",
    BINDING,
    ...args.passthrough,
    "--file",
    tmpFile,
  ]);

  if (!args.keep) {
    await readFile(tmpFile).catch(() => null); // tolerate already-removed
    const { unlink } = await import("node:fs/promises");
    await unlink(tmpFile).catch(() => null);
  } else {
    console.log(`(kept ${path.relative(ROOT, tmpFile)} for inspection)`);
  }
  console.log(`done: ${count} file(s) imported`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
