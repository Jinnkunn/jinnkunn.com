#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { encode } from "next-auth/jwt";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { readActiveDeployment } from "../_lib/cloudflare-api.mjs";
import { effectiveCodeSha } from "../_lib/deploy-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WRANGLER_TOML = path.join(ROOT, "wrangler.toml");
const STATIC_ROOT = path.join(ROOT, ".open-next", "assets", "__static");
const ENVIRONMENTS = new Set(["staging", "production"]);
const RELEASE_HISTORY_PATH = path.join(
  ROOT,
  ".cache",
  "release",
  "release-history.jsonl",
);

function parseArgs(argv = process.argv.slice(2)) {
  const rawEnv =
    argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ||
    "staging";
  const env = ENVIRONMENTS.has(rawEnv) ? rawEnv : "staging";
  return {
    env,
    dryRun: argv.includes("--dry-run"),
    skipBuild: argv.includes("--skip-build"),
    skipVerify: argv.includes("--skip-verify"),
    autoCommitContent: !argv.includes("--no-auto-commit-content"),
    rollback: argv.includes("--rollback"),
    clear: argv.includes("--clear"),
    fromStaging: argv.includes("--from-staging"),
    listSnapshots: argv.includes("--list-snapshots"),
    snapshotId:
      argv.find((arg) => arg.startsWith("--snapshot="))?.slice("--snapshot=".length) ||
      "",
  };
}

function run(command, args, options = {}) {
  const capture = Boolean(options.capture);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    const label = options.label || [command, ...args].join(" ");
    throw new Error(`${label} failed${output ? `\n${output}` : ""}`);
  }
  return output;
}

function logPhase(message) {
  console.log(`[publish-content] ${message}`);
}

function gitValue(args) {
  return run("git", args, { capture: true, label: `git ${args.join(" ")}` }).trim();
}

function parsePorcelainPath(line) {
  const raw = String(line || "").slice(3).trim();
  const arrow = " -> ";
  return raw.includes(arrow) ? raw.split(arrow).at(-1).trim() : raw;
}

function readGitState() {
  const sha = gitValue(["rev-parse", "HEAD"]);
  const branchRaw = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = run("git", ["status", "--porcelain"], {
    capture: true,
    label: "git status --porcelain",
  });
  const dirtyFiles = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePorcelainPath);
  return {
    sha,
    branch: branchRaw === "HEAD" ? "detached" : branchRaw,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
  };
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
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
  const match = /^\s*database_id\s*=\s*"([^"]+)"/m.exec(block);
  if (!match) throw new Error(`Missing database_id for env.${env}.d1_databases`);
  return match[1];
}

function workerNameForEnv(env) {
  const explicit = env === "staging"
    ? readEnv("CLOUDFLARE_WORKER_NAME_STAGING")
    : readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION");
  if (explicit) return explicit;
  const raw = fs.readFileSync(WRANGLER_TOML, "utf8");
  const marker = `[env.${env}]`;
  const start = raw.indexOf(marker);
  if (start < 0) return env === "staging" ? "jinnkunn-site-staging" : "jinnkunn-site";
  const rest = raw.slice(start + marker.length);
  const nextBlock = rest.search(/\n\[/);
  const block = nextBlock >= 0 ? rest.slice(0, nextBlock) : rest;
  const match = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
  return match?.[1] || (env === "staging" ? "jinnkunn-site-staging" : "jinnkunn-site");
}

async function cfD1Query({ env, sql, params = [] }) {
  const cfAccount = accountId();
  const token = apiToken();
  const databaseId = databaseIdForEnv(env);
  if (!cfAccount) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");
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
  return payload?.result;
}

async function ensureOverlayTable(env) {
  await cfD1Query({
    env,
    sql: `CREATE TABLE IF NOT EXISTS static_shell_overlays (
      asset_path TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
      content_sha TEXT NOT NULL,
      source_sha TEXT,
      source_branch TEXT,
      updated_at INTEGER NOT NULL
    )`,
  });
  await cfD1Query({
    env,
    sql: "CREATE INDEX IF NOT EXISTS idx_static_shell_overlays_updated_at ON static_shell_overlays (updated_at DESC)",
  });
  await cfD1Query({
    env,
    sql: `CREATE TABLE IF NOT EXISTS static_shell_overlay_snapshots (
      id TEXT PRIMARY KEY,
      env TEXT NOT NULL,
      snapshot_sha TEXT NOT NULL,
      source_sha TEXT,
      source_branch TEXT,
      file_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      note TEXT
    )`,
  });
  await cfD1Query({
    env,
    sql: "CREATE INDEX IF NOT EXISTS idx_static_shell_overlay_snapshots_created_at ON static_shell_overlay_snapshots (created_at DESC)",
  });
  await cfD1Query({
    env,
    sql: `CREATE TABLE IF NOT EXISTS static_shell_overlay_versions (
      snapshot_id TEXT NOT NULL,
      asset_path TEXT NOT NULL,
      body TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_sha TEXT NOT NULL,
      source_sha TEXT,
      source_branch TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, asset_path)
    )`,
  });
  await cfD1Query({
    env,
    sql: "CREATE INDEX IF NOT EXISTS idx_static_shell_overlay_versions_snapshot_id ON static_shell_overlay_versions (snapshot_id)",
  });
}

function autoCommitContent(git) {
  const contentDirty = git.dirtyFiles.filter((file) => file.startsWith("content/"));
  if (contentDirty.length === 0) return null;
  run("git", ["add", "--", "content"], { label: "git add content/" });
  run(
    "git",
    [
      "commit",
      "-m",
      `chore(content): publish content overlay source ${git.sha.slice(0, 12)}`,
    ],
    { label: "git commit content/" },
  );
  let pushed = false;
  let pushError = "";
  try {
    run("git", ["push"], { label: "git push" });
    pushed = true;
  } catch (error) {
    pushError = error?.message || String(error);
  }
  return {
    files: contentDirty,
    newSha: gitValue(["rev-parse", "HEAD"]),
    pushed,
    pushError,
  };
}

function appendReleaseHistory(entry) {
  try {
    fs.mkdirSync(path.dirname(RELEASE_HISTORY_PATH), { recursive: true });
    fs.appendFileSync(
      RELEASE_HISTORY_PATH,
      `${JSON.stringify({ ...entry, recordedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(
      `[publish-content] failed to append release history: ${error?.message || error}`,
    );
  }
}

function assertContentOnlyClean(git) {
  if (git.branch !== "main" && readEnv("ALLOW_NON_MAIN_CONTENT_PUBLISH") !== "1") {
    throw new Error(
      `Content publish must run from main, not ${git.branch}. Set ALLOW_NON_MAIN_CONTENT_PUBLISH=1 only for an intentional emergency.`,
    );
  }
  const nonContent = git.dirtyFiles.filter((file) => !file.startsWith("content/"));
  if (nonContent.length === 0) return;
  throw new Error(
    [
      "Content publish refuses to build with non-content working-tree changes.",
      "Commit/stash these files or use the full Code Release path:",
      ...nonContent.slice(0, 12).map((file) => `  - ${file}`),
      nonContent.length > 12 ? `  (+${nonContent.length - 12} more)` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function hashContentInput(root = ROOT) {
  const contentRoot = path.join(root, "content");
  if (!fs.existsSync(contentRoot)) return "";
  const files = [];
  function walk(absDir, relDir = "") {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (rel === "local" || rel.startsWith("local/")) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        files.push({ abs, rel: `content/${rel}` });
      }
    }
  }
  walk(contentRoot);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = crypto.createHash("sha1");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(fs.readFileSync(file.abs));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function contentOnlyDiffFrom(baseSha, headSha) {
  if (!baseSha || !headSha || baseSha === headSha) return { ok: true, files: [] };
  let output = "";
  try {
    output = run("git", ["diff", "--name-only", `${baseSha}..${headSha}`], {
      capture: true,
      label: `git diff --name-only ${baseSha}..${headSha}`,
    });
  } catch (error) {
    return {
      ok: false,
      files: [],
      error: error?.message || String(error),
    };
  }
  const files = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    ok: files.every((file) => file.startsWith("content/")),
    files,
  };
}

async function readTargetWorkerDeployment(env) {
  const cfAccount = accountId();
  const token = apiToken();
  const workerName = workerNameForEnv(env);
  const active = await readActiveDeployment({
    accountId: cfAccount,
    apiToken: token,
    workerName,
  });
  const workerCodeSha = effectiveCodeSha(active?.meta);
  if (!active || !workerCodeSha) {
    throw new Error(
      `Could not read active ${env} Worker code metadata for ${workerName}. Use the full Deploy Staging / Promote Production path first.`,
    );
  }
  return {
    workerName,
    versionId: String(active.versionId || ""),
    deploymentId: String(active.deploymentId || ""),
    workerCodeSha,
    meta: active.meta,
  };
}

async function assertTargetWorkerAcceptsContentOnly({ env, git }) {
  const deployment = await readTargetWorkerDeployment(env);
  if (deployment.workerCodeSha === git.sha) return deployment;
  const diff = contentOnlyDiffFrom(deployment.workerCodeSha, git.sha);
  if (diff.ok) {
    logPhase(
      `${env} Worker code ${deployment.workerCodeSha.slice(0, 12)} is compatible; local HEAD differs only in content/`,
    );
    return deployment;
  }
  const sample = diff.files.length > 0
    ? diff.files.slice(0, 12).map((file) => `  - ${file}`).join("\n")
    : diff.error || "Could not compare Worker code with local HEAD.";
  throw new Error(
    [
      `${env} Worker code is ${deployment.workerCodeSha}, but local HEAD is ${git.sha}.`,
      "Content publish is blocked because code/static files changed since the active Worker.",
      env === "staging"
        ? "Run `npm run release:staging` first, then retry content publish."
        : "Run `npm run release:prod:from-staging` first, then retry production content publish.",
      sample,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function syncStagingD1ToContent() {
  logPhase("dumping staging D1 content to content/");
  run(
    "node",
    [
      "scripts/content/dump-content-from-db.mjs",
      "--remote",
      "--env=staging",
      "--quiet",
    ],
    { label: "dump staging D1 to content/" },
  );
}

function buildStaticShells({ nextBuildId }) {
  logPhase(`running Next build with live build id ${nextBuildId}`);
  run("npm", ["run", "build"], {
    label: "build",
    env: { NEXT_BUILD_ID: nextBuildId },
  });
  logPhase("exporting classic CSS assets");
  run("node", ["scripts/build/export-classic-css-assets.mjs"], {
    label: "export classic CSS assets",
  });
  logPhase("exporting static shell assets");
  run("node", ["scripts/build/export-static-shell-assets.mjs"], {
    label: "export static shell assets",
  });
}

function walkStaticOverlayFiles(root = STATIC_ROOT) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(html|json)$/.test(entry.name)) continue;
      const rel = path.relative(STATIC_ROOT, abs).replace(/\\/g, "/");
      out.push({
        abs,
        assetPath: `/__static/${rel}`,
        contentType: entry.name.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8",
      });
    }
  }
  out.sort((a, b) => a.assetPath.localeCompare(b.assetPath));
  return out;
}

function extractNextStaticRefs(source) {
  return [
    ...new Set(
      [...String(source || "").matchAll(/\/_next\/static\/[^"'()\s\\]+/g)]
        .map((match) => match[0])
        .map((ref) => ref.replace(/[?#].*$/, ""))
        .filter((ref) => /\.[a-z0-9]+$/i.test(ref))
        .filter(Boolean),
    ),
  ].sort();
}

function extractBuildIdFromStaticRefs(refs) {
  for (const ref of refs) {
    const match = /^\/_next\/static\/([^/]+)\/(?:_buildManifest|_ssgManifest)\.js$/i.exec(
      ref,
    );
    if (match?.[1]) return match[1];
  }
  return "";
}

function normalizeOrigin(env) {
  if (env === "staging") {
    return (
      readEnv("STAGING_CONTENT_PUBLISH_ORIGIN") ||
      readEnv("VERIFY_CF_STAGING_ORIGIN") ||
      "https://staging.jinkunchen.com"
    ).replace(/\/+$/, "");
  }
  return (
    readEnv("PRODUCTION_CONTENT_PUBLISH_ORIGIN") ||
    readEnv("SITE_ORIGIN") ||
    "https://jinkunchen.com"
  ).replace(/\/+$/, "");
}

function firstAllowedGithubUser() {
  return String(process.env.SITE_ADMIN_GITHUB_USERS || "")
    .split(/[,\n]/)
    .map((part) => part.trim().replace(/^@+/, "").toLowerCase())
    .find(Boolean) || "";
}

async function stagingCookieIfNeeded(env) {
  if (env !== "staging") return "";
  const secret = readEnv("NEXTAUTH_SECRET") || readEnv("AUTH_SECRET");
  const login = firstAllowedGithubUser();
  if (!secret || !login) return "";
  const token = await encode({
    secret,
    token: {
      sub: `content-publish-${login}`,
      login,
      name: login,
    },
    maxAge: 5 * 60,
  });
  return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
}

async function fetchLiveBuildId(env) {
  const origin = normalizeOrigin(env);
  const cookie = await stagingCookieIfNeeded(env);
  const response = await fetch(`${origin}/`, {
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  });
  const text = await response.text().catch(() => "");
  if (response.status !== 200) {
    throw new Error(
      `Could not read live ${env} build id from ${origin}/ (status ${response.status}).`,
    );
  }
  const refs = extractNextStaticRefs(text);
  const liveBuildId = extractBuildIdFromStaticRefs(refs);
  if (liveBuildId) return liveBuildId;
  const fallback = readEnv("NEXT_BUILD_ID") || "content-overlay";
  if (refs.length > 0) {
    logPhase(`live ${env} HTML has no build-id manifest refs; using ${fallback}`);
    return fallback;
  }
  logPhase(`live ${env} HTML has no _next/static refs; using ${fallback}`);
  return fallback;
}

async function assertReferencedAssetsExist({ env, files }) {
  const origin = normalizeOrigin(env);
  const cookie = await stagingCookieIfNeeded(env);
  const refs = new Set();
  for (const file of files) {
    if (!file.assetPath.endsWith(".html")) continue;
    const source = fs.readFileSync(file.abs, "utf8");
    for (const ref of extractNextStaticRefs(source)) refs.add(ref);
  }
  const missing = [];
  logPhase(`checking ${refs.size} referenced _next/static asset${refs.size === 1 ? "" : "s"}`);
  for (const ref of refs) {
    const response = await fetch(`${origin}${ref}`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: cookie ? { cookie } : {},
    });
    await response.arrayBuffer().catch(() => null);
    if (response.status !== 200) missing.push({ ref, status: response.status });
  }
  if (missing.length > 0) {
    throw new Error(
      [
        "Content publish produced HTML that references static assets not present in the current Worker.",
        "This means code/CSS assets changed; use the full Code Release path.",
        ...missing.slice(0, 12).map((item) => `  - ${item.ref} (${item.status})`),
        missing.length > 12 ? `  (+${missing.length - 12} more)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return { checked: refs.size };
}

async function assertReferencedAssetsExistForRows({ env, rows }) {
  const origin = normalizeOrigin(env);
  const cookie = await stagingCookieIfNeeded(env);
  const refs = new Set();
  for (const row of rows) {
    if (!String(row.asset_path || "").endsWith(".html")) continue;
    for (const ref of extractNextStaticRefs(row.body)) refs.add(ref);
  }
  const missing = [];
  logPhase(`checking ${refs.size} copied _next/static asset${refs.size === 1 ? "" : "s"}`);
  for (const ref of refs) {
    const response = await fetch(`${origin}${ref}`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: cookie ? { cookie } : {},
    });
    await response.arrayBuffer().catch(() => null);
    if (response.status !== 200) missing.push({ ref, status: response.status });
  }
  if (missing.length > 0) {
    throw new Error(
      [
        "Production cannot serve the staging content overlay because required static assets are missing.",
        "Promote the matching staging Worker to production first, then retry.",
        ...missing.slice(0, 12).map((item) => `  - ${item.ref} (${item.status})`),
        missing.length > 12 ? `  (+${missing.length - 12} more)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return { checked: refs.size };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOverlayServing(env) {
  const origin = normalizeOrigin(env);
  const cookie = await stagingCookieIfNeeded(env);
  const paths = ["/", "/news"];
  const attempts = 8;
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = [];
    for (const pathname of paths) {
      const response = await fetch(`${origin}${pathname}`, {
        redirect: "manual",
        cache: "no-store",
        headers: cookie ? { cookie } : {},
      });
      await response.arrayBuffer().catch(() => null);
      results.push({
        path: pathname,
        status: response.status,
        staticShell: response.headers.get("x-static-shell") || "",
        staticOverlay: response.headers.get("x-static-overlay") || "",
      });
    }
    last = results;
    if (
      results.every(
        (item) =>
          item.status === 200 &&
          item.staticShell === "1" &&
          item.staticOverlay === "1",
      )
    ) {
      return { ok: true, attempts: attempt, routes: results };
    }
    await sleep(2_000);
  }
  throw new Error(
    `Overlay upload completed, but ${env} did not serve overlay shells yet: ${JSON.stringify(last)}`,
  );
}

function overlaySnapshot(files) {
  const hash = crypto.createHash("sha1");
  for (const file of files) {
    const body = fs.readFileSync(file.abs);
    hash.update(file.assetPath);
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isMissingOverlayTableError(error) {
  return /no such table:\s*static_shell_overlay/i.test(String(error?.message || error));
}

function d1Rows(result) {
  const rows = result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
}

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function readOverlayMeta(env) {
  try {
    const result = await cfD1Query({
      env,
      sql: "SELECT asset_path, content_type, content_sha FROM static_shell_overlays",
    });
    return new Map(
      d1Rows(result).map((row) => [
        String(row.asset_path || ""),
        {
          contentSha: String(row.content_sha || ""),
          contentType: String(row.content_type || ""),
        },
      ]),
    );
  } catch (error) {
    if (isMissingOverlayTableError(error)) return new Map();
    throw error;
  }
}

async function readOverlayRows(env) {
  try {
    const result = await cfD1Query({
      env,
      sql: `SELECT asset_path, body, content_type, content_sha, source_sha, source_branch, updated_at
        FROM static_shell_overlays
        ORDER BY asset_path`,
    });
    return d1Rows(result).map((row) => ({
      asset_path: String(row.asset_path || ""),
      body: String(row.body || ""),
      content_type: String(row.content_type || "text/html; charset=utf-8"),
      content_sha: String(row.content_sha || ""),
      source_sha: String(row.source_sha || ""),
      source_branch: String(row.source_branch || ""),
      updated_at: Number(row.updated_at || 0),
    })).filter((row) => row.asset_path);
  } catch (error) {
    if (isMissingOverlayTableError(error)) return [];
    throw error;
  }
}

async function readOverlayStatus(env) {
  try {
    const result = await cfD1Query({
      env,
      sql: "SELECT body FROM static_shell_overlays WHERE asset_path = ? LIMIT 1",
      params: ["/__static/content-overlay-status.json"],
    });
    const body = String(d1Rows(result)[0]?.body || "");
    if (!body) return null;
    return JSON.parse(body);
  } catch (error) {
    if (isMissingOverlayTableError(error)) return null;
    return null;
  }
}

async function insertRows({ env, table, columns, rows, chunkSize = 8 }) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const group of chunks(rows, chunkSize)) {
    const rowSql = `(${columns.map(() => "?").join(", ")})`;
    await cfD1Query({
      env,
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES ${group.map(() => rowSql).join(", ")}`,
      params: group.flatMap((row) => columns.map((column) => row[column] ?? null)),
    });
    inserted += group.length;
  }
  return inserted;
}

async function deleteOverlayPaths(env, assetPaths) {
  let deleted = 0;
  for (const group of chunks(assetPaths, 50)) {
    await cfD1Query({
      env,
      sql: `DELETE FROM static_shell_overlays WHERE asset_path IN (${group.map(() => "?").join(", ")})`,
      params: group,
    });
    deleted += group.length;
  }
  return deleted;
}

function buildShellOverlayRows({ files, git, updatedAt }) {
  return files.map((file) => {
    const body = fs.readFileSync(file.abs, "utf8");
    return {
      asset_path: file.assetPath,
      body,
      content_type: file.contentType,
      content_sha: sha1(body),
      source_sha: git.sha,
      source_branch: git.branch,
      updated_at: updatedAt,
    };
  });
}

function buildStatusOverlayRow({
  contentInputSha,
  deletedShellCount,
  env,
  git,
  publishedAt,
  shellChangedCount,
  shellFileCount,
  snapshotSha,
  targetBuildId,
  updatedAt,
  workerCodeSha,
}) {
  const body = `${JSON.stringify(
    {
      ok: true,
      env,
      sourceSha: git.sha,
      sourceBranch: git.branch,
      workerCodeSha,
      targetBuildId,
      contentInputSha,
      snapshotSha,
      fileCount: shellFileCount,
      changedFiles: shellChangedCount,
      deletedFiles: deletedShellCount,
      publishedAt,
    },
    null,
    2,
  )}\n`;
  return {
    asset_path: "/__static/content-overlay-status.json",
    body,
    content_type: "application/json; charset=utf-8",
    content_sha: sha1(body),
    source_sha: git.sha,
    source_branch: git.branch,
    updated_at: updatedAt,
  };
}

async function prepareOverlayDiff({
  contentInputSha,
  env,
  files,
  git,
  snapshotSha,
  targetBuildId,
  workerCodeSha,
}) {
  const updatedAt = Date.now();
  const existing = await readOverlayMeta(env);
  const shellRows = buildShellOverlayRows({ files, git, updatedAt });
  const shellPaths = new Set(shellRows.map((row) => row.asset_path));
  const shellChanged = shellRows.filter((row) => {
    const current = existing.get(row.asset_path);
    return !current ||
      current.contentSha !== row.content_sha ||
      current.contentType !== row.content_type;
  });
  const deleted = [...existing.keys()]
    .filter((assetPath) => assetPath !== "/__static/content-overlay-status.json")
    .filter((assetPath) => !shellPaths.has(assetPath));
  const statusRow = buildStatusOverlayRow({
    contentInputSha,
    deletedShellCount: deleted.length,
    env,
    git,
    publishedAt: new Date(updatedAt).toISOString(),
    shellChangedCount: shellChanged.length,
    shellFileCount: shellRows.length,
    snapshotSha,
    targetBuildId,
    updatedAt,
    workerCodeSha,
  });
  const statusCurrent = existing.get(statusRow.asset_path);
  const statusChanged = !statusCurrent ||
    statusCurrent.contentSha !== statusRow.content_sha ||
    statusCurrent.contentType !== statusRow.content_type;
  const changedRows = statusChanged ? [...shellChanged, statusRow] : shellChanged;
  return {
    changedAssetPaths: new Set(changedRows.map((row) => row.asset_path)),
    changedRows,
    deleted,
    shellChangedCount: shellChanged.length,
    statusChanged,
    totalFiles: shellRows.length,
    updatedAt,
  };
}

async function snapshotCurrentOverlay({ env, git, note }) {
  await ensureOverlayTable(env);
  const rows = await readOverlayRows(env);
  if (rows.length === 0) return null;
  const createdAt = Date.now();
  const snapshotSha = sha1(JSON.stringify(rows.map((row) => [
    row.asset_path,
    row.content_sha,
    row.source_sha,
    row.updated_at,
  ])));
  const id = `${createdAt}-${snapshotSha.slice(0, 12)}`;
  await cfD1Query({
    env,
    sql: `INSERT OR REPLACE INTO static_shell_overlay_snapshots
      (id, env, snapshot_sha, source_sha, source_branch, file_count, created_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, env, snapshotSha, git.sha, git.branch, rows.length, createdAt, note],
  });
  await insertRows({
    env,
    table: "static_shell_overlay_versions",
    columns: [
      "snapshot_id",
      "asset_path",
      "body",
      "content_type",
      "content_sha",
      "source_sha",
      "source_branch",
      "updated_at",
    ],
    rows: rows.map((row) => ({
      snapshot_id: id,
      ...row,
    })),
    chunkSize: 5,
  });
  return { id, fileCount: rows.length, snapshotSha };
}

async function applyOverlayDiff({ env, diff, git, dryRun }) {
  if (dryRun) {
    return {
      backupSnapshot: null,
      deleted: diff.deleted.length,
      uploaded: diff.changedRows.length,
      unchanged: diff.totalFiles - diff.shellChangedCount,
    };
  }
  if (diff.changedRows.length === 0 && diff.deleted.length === 0) {
    return {
      backupSnapshot: null,
      deleted: 0,
      uploaded: 0,
      unchanged: diff.totalFiles,
    };
  }
  logPhase(`creating D1 overlay table for ${env}`);
  await ensureOverlayTable(env);
  const backupSnapshot = await snapshotCurrentOverlay({
    env,
    git,
    note: "before content overlay publish",
  });
  if (diff.deleted.length > 0) {
    logPhase(`deleting ${diff.deleted.length} stale overlay file${diff.deleted.length === 1 ? "" : "s"}`);
    await deleteOverlayPaths(env, diff.deleted);
  }
  if (diff.changedRows.length > 0) {
    logPhase(`uploading ${diff.changedRows.length} changed overlay file${diff.changedRows.length === 1 ? "" : "s"}`);
    await insertRows({
      env,
      table: "static_shell_overlays",
      columns: [
        "asset_path",
        "body",
        "content_type",
        "content_sha",
        "source_sha",
        "source_branch",
        "updated_at",
      ],
      rows: diff.changedRows,
      chunkSize: 5,
    });
  }
  return {
    backupSnapshot,
    deleted: diff.deleted.length,
    uploaded: diff.changedRows.length,
    unchanged: diff.totalFiles - diff.shellChangedCount,
  };
}

async function latestOverlaySnapshotId(env) {
  const result = await cfD1Query({
    env,
    sql: "SELECT id FROM static_shell_overlay_snapshots ORDER BY created_at DESC LIMIT 1",
  });
  return String(d1Rows(result)[0]?.id || "");
}

async function readSnapshotRows(env, snapshotId) {
  const result = await cfD1Query({
    env,
    sql: `SELECT asset_path, body, content_type, content_sha, source_sha, source_branch, updated_at
      FROM static_shell_overlay_versions
      WHERE snapshot_id = ?
      ORDER BY asset_path`,
    params: [snapshotId],
  });
  return d1Rows(result).map((row) => ({
    asset_path: String(row.asset_path || ""),
    body: String(row.body || ""),
    content_type: String(row.content_type || "text/html; charset=utf-8"),
    content_sha: String(row.content_sha || ""),
    source_sha: String(row.source_sha || ""),
    source_branch: String(row.source_branch || ""),
    updated_at: Number(row.updated_at || 0),
  })).filter((row) => row.asset_path);
}

async function restoreOverlaySnapshot({ env, git, requestedSnapshotId, dryRun }) {
  await ensureOverlayTable(env);
  const snapshotId = requestedSnapshotId || await latestOverlaySnapshotId(env);
  if (!snapshotId) throw new Error(`No overlay snapshot found for ${env}.`);
  const rows = await readSnapshotRows(env, snapshotId);
  if (rows.length === 0) {
    throw new Error(`Overlay snapshot ${snapshotId} has no rows.`);
  }
  if (dryRun) {
    return { backupSnapshot: null, restored: rows.length, snapshotId };
  }
  const backupSnapshot = await snapshotCurrentOverlay({
    env,
    git,
    note: `before content overlay rollback to ${snapshotId}`,
  });
  await cfD1Query({ env, sql: "DELETE FROM static_shell_overlays" });
  await insertRows({
    env,
    table: "static_shell_overlays",
    columns: [
      "asset_path",
      "body",
      "content_type",
      "content_sha",
      "source_sha",
      "source_branch",
      "updated_at",
    ],
    rows,
    chunkSize: 5,
  });
  return { backupSnapshot, restored: rows.length, snapshotId };
}

async function clearOverlay({ env, git, dryRun }) {
  await ensureOverlayTable(env);
  const rows = await readOverlayRows(env);
  if (dryRun) return { backupSnapshot: null, cleared: rows.length };
  const backupSnapshot = await snapshotCurrentOverlay({
    env,
    git,
    note: "before content overlay clear",
  });
  await cfD1Query({ env, sql: "DELETE FROM static_shell_overlays" });
  return { backupSnapshot, cleared: rows.length };
}

async function listOverlaySnapshots(env) {
  await ensureOverlayTable(env);
  const result = await cfD1Query({
    env,
    sql: `SELECT id, snapshot_sha, source_sha, source_branch, file_count, created_at, note
      FROM static_shell_overlay_snapshots
      ORDER BY created_at DESC
      LIMIT 12`,
  });
  return d1Rows(result);
}

function rewriteStatusRowForProduction({ row, git, productionWorker }) {
  const updatedAt = Date.now();
  let status = {};
  try {
    status = JSON.parse(row.body || "{}");
  } catch {
    status = {};
  }
  const body = `${JSON.stringify(
    {
      ...status,
      ok: true,
      env: "production",
      copiedFromEnv: "staging",
      copiedFromSnapshotSha: status.snapshotSha || "",
      copiedFromPublishedAt: status.publishedAt || "",
      sourceSha: status.sourceSha || git.sha,
      sourceBranch: status.sourceBranch || git.branch,
      workerCodeSha: productionWorker.workerCodeSha,
      productionWorkerVersionId: productionWorker.versionId,
      publishedAt: new Date(updatedAt).toISOString(),
    },
    null,
    2,
  )}\n`;
  return {
    ...row,
    body,
    content_type: "application/json; charset=utf-8",
    content_sha: sha1(body),
    source_sha: status.sourceSha || git.sha,
    source_branch: status.sourceBranch || git.branch,
    updated_at: updatedAt,
  };
}

async function copyStagingOverlayToProduction({ git, dryRun, skipVerify }) {
  await ensureOverlayTable("staging");
  await ensureOverlayTable("production");
  const stagingRows = await readOverlayRows("staging");
  if (stagingRows.length === 0) {
    throw new Error("No staging content overlay exists. Publish content to staging first.");
  }
  const stagingStatus = await readOverlayStatus("staging");
  if (!stagingStatus?.ok) {
    throw new Error("Staging content overlay status is missing or unhealthy.");
  }
  const requiredCodeSha = String(stagingStatus.workerCodeSha || "").trim();
  if (!requiredCodeSha) {
    throw new Error(
      "Staging overlay was published by an older script without workerCodeSha. Republish staging content first.",
    );
  }
  const productionWorker = await readTargetWorkerDeployment("production");
  if (productionWorker.workerCodeSha !== requiredCodeSha) {
    throw new Error(
      [
        "Production Worker code does not match the verified staging content overlay.",
        `  production: ${productionWorker.workerCodeSha}`,
        `  staging overlay expects: ${requiredCodeSha}`,
        "",
        "Run `npm run release:prod:from-staging` first, then publish the same content overlay to production.",
      ].join("\n"),
    );
  }

  const copiedRows = stagingRows.map((row) =>
    row.asset_path === "/__static/content-overlay-status.json"
      ? rewriteStatusRowForProduction({ row, git, productionWorker })
      : {
          ...row,
          source_sha: stagingStatus.sourceSha || row.source_sha || git.sha,
          source_branch: stagingStatus.sourceBranch || row.source_branch || git.branch,
          updated_at: Date.now(),
        },
  );
  const assets = skipVerify
    ? { checked: 0 }
    : await assertReferencedAssetsExistForRows({
        env: "production",
        rows: copiedRows,
      });
  if (dryRun) {
    return {
      assets,
      backupSnapshot: null,
      copied: copiedRows.length,
      productionWorker,
      stagingStatus,
    };
  }
  const backupSnapshot = await snapshotCurrentOverlay({
    env: "production",
    git,
    note: "before content overlay copy from staging",
  });
  await cfD1Query({ env: "production", sql: "DELETE FROM static_shell_overlays" });
  await insertRows({
    env: "production",
    table: "static_shell_overlays",
    columns: [
      "asset_path",
      "body",
      "content_type",
      "content_sha",
      "source_sha",
      "source_branch",
      "updated_at",
    ],
    rows: copiedRows,
    chunkSize: 5,
  });
  const serving = skipVerify ? null : await verifyOverlayServing("production");
  return {
    assets,
    backupSnapshot,
    copied: copiedRows.length,
    productionWorker,
    serving,
    stagingStatus,
  };
}

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true, files: [".env"] });

  if (args.listSnapshots) {
    const snapshots = await listOverlaySnapshots(args.env);
    console.log(JSON.stringify({ ok: true, env: args.env, snapshots }, null, 2));
    return;
  }

  if (args.rollback) {
    const git = readGitState();
    const rollback = await restoreOverlaySnapshot({
      env: args.env,
      git,
      requestedSnapshotId: args.snapshotId,
      dryRun: args.dryRun,
    });
    const serving =
      args.dryRun || args.skipVerify
        ? null
        : await verifyOverlayServing(args.env);
    if (!args.dryRun) {
      appendReleaseHistory({
        env: args.env,
        sha: git.sha,
        branch: git.branch,
        overlayBackupSnapshotId: rollback.backupSnapshot?.id || "",
        overlayRollbackSnapshotId: rollback.snapshotId,
        note: `content overlay rolled back (${rollback.restored} files)`,
      });
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          env: args.env,
          dryRun: args.dryRun,
          operation: "rollback",
          source: git,
          rollback,
          serving,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.clear) {
    const git = readGitState();
    const cleared = await clearOverlay({
      env: args.env,
      git,
      dryRun: args.dryRun,
    });
    if (!args.dryRun) {
      appendReleaseHistory({
        env: args.env,
        sha: git.sha,
        branch: git.branch,
        overlayBackupSnapshotId: cleared.backupSnapshot?.id || "",
        note: `content overlay cleared (${cleared.cleared} files)`,
      });
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          env: args.env,
          dryRun: args.dryRun,
          operation: "clear",
          source: git,
          cleared,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.fromStaging) {
    if (args.env !== "production") {
      throw new Error("--from-staging only supports --env=production.");
    }
    const git = readGitState();
    assertContentOnlyClean(git);
    const copied = await copyStagingOverlayToProduction({
      git,
      dryRun: args.dryRun,
      skipVerify: args.skipVerify,
    });
    if (!args.dryRun) {
      appendReleaseHistory({
        env: "production",
        sha: copied.stagingStatus?.sourceSha || git.sha,
        branch: copied.stagingStatus?.sourceBranch || git.branch,
        overlaySnapshotSha: copied.stagingStatus?.snapshotSha || "",
        overlayBackupSnapshotId: copied.backupSnapshot?.id || "",
        note: `content overlay copied from staging (${copied.copied} files)`,
      });
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          env: "production",
          dryRun: args.dryRun,
          operation: "copy-from-staging",
          source: git,
          stagingOverlay: {
            sourceSha: copied.stagingStatus?.sourceSha || "",
            workerCodeSha: copied.stagingStatus?.workerCodeSha || "",
            contentInputSha: copied.stagingStatus?.contentInputSha || "",
            targetBuildId: copied.stagingStatus?.targetBuildId || "",
            snapshotSha: copied.stagingStatus?.snapshotSha || "",
          },
          productionWorker: {
            codeSha: copied.productionWorker.workerCodeSha,
            versionId: copied.productionWorker.versionId,
          },
          copied: copied.copied,
          referencedAssetsChecked: copied.assets.checked,
          backupSnapshotId: copied.backupSnapshot?.id || "",
          serving: copied.serving || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.env === "staging") syncStagingD1ToContent();

  let git = readGitState();
  assertContentOnlyClean(git);
  let contentAutoCommit = null;
  if (git.dirty && args.autoCommitContent && !args.dryRun) {
    contentAutoCommit = autoCommitContent(git);
    git = readGitState();
  }
  assertContentOnlyClean(git);

  const contentInputSha = hashContentInput();
  const targetWorker = await assertTargetWorkerAcceptsContentOnly({ env: args.env, git });
  const liveBuildId = args.skipBuild ? "" : await fetchLiveBuildId(args.env);
  const currentStatus = await readOverlayStatus(args.env);
  if (
    currentStatus?.ok === true &&
    currentStatus.contentInputSha === contentInputSha &&
    currentStatus.workerCodeSha === targetWorker.workerCodeSha &&
    currentStatus.targetBuildId === liveBuildId
  ) {
    logPhase("content overlay is already current; skipping build and upload");
    console.log(
      JSON.stringify(
        {
          ok: true,
          env: args.env,
          dryRun: args.dryRun,
          operation: "noop",
          skippedBuild: true,
          source: git,
          contentAutoCommit,
          contentInputSha,
          liveBuildId,
          workerCodeSha: targetWorker.workerCodeSha,
          snapshotSha: currentStatus.snapshotSha || "",
          files: Number(currentStatus.fileCount || 0),
          referencedAssetsChecked: 0,
          uploaded: 0,
          deleted: 0,
          unchanged: Number(currentStatus.fileCount || 0),
          backupSnapshotId: "",
          serving: null,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!args.skipBuild) buildStaticShells({ nextBuildId: liveBuildId });
  const files = walkStaticOverlayFiles();
  if (files.length === 0) throw new Error("No static shell files found to publish.");

  const snapshotSha = overlaySnapshot(files);
  const diff = await prepareOverlayDiff({
    contentInputSha,
    env: args.env,
    files,
    git,
    snapshotSha,
    targetBuildId: liveBuildId,
    workerCodeSha: targetWorker.workerCodeSha,
  });
  const changedFiles = files.filter((file) => diff.changedAssetPaths.has(file.assetPath));
  const assets = args.skipVerify
    ? { checked: 0 }
    : await assertReferencedAssetsExist({ env: args.env, files: changedFiles });
  const upload = await applyOverlayDiff({
    env: args.env,
    diff,
    git,
    dryRun: args.dryRun,
  });
  const serving =
    args.dryRun || args.skipVerify || (upload.uploaded === 0 && upload.deleted === 0)
      ? null
      : await verifyOverlayServing(args.env);

  if (!args.dryRun) {
    appendReleaseHistory({
      env: args.env,
      sha: git.sha,
      branch: git.branch,
      dirty: git.dirty,
      overlaySnapshotSha: snapshotSha,
      overlayBackupSnapshotId: upload.backupSnapshot?.id || "",
      note: upload.uploaded === 0 && upload.deleted === 0
        ? `content overlay unchanged (${files.length} files)`
        : `content overlay published (${upload.uploaded} changed, ${upload.deleted} deleted)`,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        env: args.env,
        dryRun: args.dryRun,
        source: git,
        contentAutoCommit,
        contentInputSha,
        workerCodeSha: targetWorker.workerCodeSha,
        liveBuildId,
        snapshotSha,
        files: files.length,
        referencedAssetsChecked: assets.checked,
        uploaded: upload.uploaded,
        deleted: upload.deleted,
        unchanged: upload.unchanged,
        backupSnapshotId: upload.backupSnapshot?.id || "",
        serving,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  try {
    const env = process.argv
      .find((arg) => arg.startsWith("--env="))
      ?.slice("--env=".length) || "staging";
    appendReleaseHistory({
      env,
      sha: gitValue(["rev-parse", "HEAD"]) || "unknown",
      failure: String(error?.message || error).split("\n")[0]?.slice(0, 240) ?? "unknown",
      note: "content overlay publish failed",
    });
  } catch {
    // Keep the real error visible.
  }
  console.error(error?.stack || String(error));
  process.exit(1);
});
