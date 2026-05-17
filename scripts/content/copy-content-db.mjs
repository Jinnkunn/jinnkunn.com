#!/usr/bin/env node
// Mirror D1 `content_files` rows from one environment to another.
//
// Staging remains the operator-editing source of truth. Production keeps a
// runtime mirror so production admin/mobile APIs can read the same content
// that was just promoted, without making production an editing target.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";

const BINDING = "SITE_ADMIN_DB";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const WRANGLER_TOML = path.join(ROOT, "wrangler.toml");

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: false,
    json: false,
    quiet: false,
    sourceEnv: "staging",
    targetEnv: "production",
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--quiet") out.quiet = true;
    else if (arg.startsWith("--source-env=")) out.sourceEnv = arg.slice("--source-env=".length);
    else if (arg.startsWith("--target-env=")) out.targetEnv = arg.slice("--target-env=".length);
    else if (arg === "--remote") {
      // Kept for package-script readability. This script always targets remote D1.
    } else {
      console.error(`unknown arg: ${arg}`);
      console.error(
        "usage: node scripts/content/copy-content-db.mjs [--remote] [--source-env=staging] [--target-env=production] [--dry-run] [--json] [--quiet]",
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

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function accountId() {
  return readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
}

function apiToken() {
  return readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
}

function databaseIdForEnv(env) {
  const raw = fs.readFileSync(WRANGLER_TOML, "utf8");
  const marker = `[[env.${env}.d1_databases]]`;
  const start = raw.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker} in wrangler.toml`);
  const rest = raw.slice(start + marker.length);
  const nextBlock = rest.search(/\n\[/);
  const block = nextBlock >= 0 ? rest.slice(0, nextBlock) : rest;
  const bindingMatch = /^\s*binding\s*=\s*"([^"]+)"/m.exec(block);
  const databaseMatch = /^\s*database_id\s*=\s*"([^"]+)"/m.exec(block);
  if (bindingMatch?.[1] !== BINDING) {
    throw new Error(`Missing ${BINDING} binding for env.${env}`);
  }
  if (!databaseMatch) throw new Error(`Missing database_id for env.${env}.${BINDING}`);
  return databaseMatch[1];
}

function normalizeEnv(value, label) {
  const raw = String(value || "").trim();
  if (raw === "staging" || raw === "production") return raw;
  console.error(`invalid --${label}: ${raw || "(empty)"}`);
  process.exit(2);
}

async function cfD1Query({ env, sql, params = [] }) {
  const cfAccount = accountId();
  const token = apiToken();
  if (!cfAccount) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  const databaseId = databaseIdForEnv(env);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccount)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Cloudflare D1 returned non-JSON: ${text.slice(0, 240)}`);
  }
  if (!response.ok || payload?.success === false) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item.message).join("; ")
      : text;
    throw new Error(`Cloudflare D1 query failed (${response.status}): ${errors}`);
  }
  const result = payload?.result;
  if (Array.isArray(result)) {
    const failed = result.find((entry) => entry?.success === false);
    if (failed) throw new Error(`Cloudflare D1 query failed: ${JSON.stringify(failed)}`);
    return result[0]?.results ?? [];
  }
  return result?.results ?? [];
}

function normalizeRow(row) {
  const relPath = String(row.rel_path || "");
  const bodyHex = String(row.body_hex || "");
  const sha = String(row.sha || "");
  const rawUpdatedAt = row.updated_at;
  const updatedAtNumber = Number(rawUpdatedAt);
  const updatedAtParsed =
    Number.isFinite(updatedAtNumber) ? updatedAtNumber : Date.parse(String(rawUpdatedAt || ""));
  if (!relPath || relPath.includes("\0")) throw new Error(`invalid rel_path: ${relPath}`);
  if (!/^[0-9a-f]*$/i.test(bodyHex)) throw new Error(`invalid body hex for ${relPath}`);
  if (!sha) throw new Error(`missing sha for ${relPath}`);
  return {
    relPath,
    bodyHex: bodyHex.toLowerCase(),
    isBinary: Number(row.is_binary || 0) ? 1 : 0,
    sha,
    size: Number(row.size || 0),
    updatedAt: Number.isFinite(updatedAtParsed) ? updatedAtParsed : Date.now(),
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

async function main() {
  loadProjectEnv({ cwd: ROOT, override: true });
  const args = parseArgs();
  const sourceRows = (
    await cfD1Query({
      env: args.sourceEnv,
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
  if (sourceRows.length === 0) {
    throw new Error(`Refusing to mirror empty ${args.sourceEnv} content_files`);
  }

  const summary = {
    ok: true,
    dryRun: args.dryRun,
    sourceEnv: args.sourceEnv,
    targetEnv: args.targetEnv,
    copied: args.dryRun ? 0 : sourceRows.length,
    source: summarizeRows(sourceRows),
  };

  if (!args.dryRun) {
    await cfD1Query({ env: args.targetEnv, sql: "DELETE FROM content_files" });
    for (const row of sourceRows) {
      if (row.isBinary) {
        throw new Error(`Refusing to mirror binary content row via text params: ${row.relPath}`);
      }
      try {
        await cfD1Query({
          env: args.targetEnv,
          sql: `INSERT INTO content_files
                  (rel_path, body, is_binary, sha, size, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [
            row.relPath,
            Buffer.from(row.bodyHex, "hex").toString("utf8"),
            row.isBinary,
            row.sha,
            row.size,
            row.updatedAt,
            row.updatedBy,
          ],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to mirror ${row.relPath}: ${message}`);
      }
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
