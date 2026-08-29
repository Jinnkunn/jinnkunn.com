#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { readActiveDeployment } from "../_lib/cloudflare-api.mjs";
import { effectiveCodeSha } from "../_lib/deploy-metadata.mjs";
import { readMarker, writeMarker } from "../_lib/release-cache.mjs";
import {
  createReleaseWorkspacePlan,
  prepareImmutableReleaseSnapshot,
  removeImmutableReleaseSnapshot,
} from "../_lib/release-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ENVIRONMENTS = new Set(["staging", "production"]);

// Per-SHA caches keep `release:staging` → `release:prod:from-staging`
// fast on the same HEAD without giving up the safety net of the next
// commit invalidating everything automatically. TTLs are conservative
// upper bounds — stop trusting a green pass after this much wall time.
const CHECKS_CACHE_BUCKET = "checks";
const CHECKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STAGING_VERIFY_BUCKET = "staging-verified";
const STAGING_VERIFY_TTL_MS = 30 * 60 * 1000;
// Staging writes a code+content-bound build artifact after a verified
// build. Production promotion may reuse it only when the caller provides
// the exact content SHA from the active staging deployment.
const BUILD_CACHE_BUCKET = "build";
const BUILD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BUILD_CACHE_PATHS = [".open-next", ".next"];

const RELEASE_HISTORY_PATH = path.join(
  ROOT,
  ".cache",
  "release",
  "release-history.jsonl",
);

// The Tauri workspace has its own package.json/tsconfig, so neither
// `next build` nor the root test run ever typechecks it. Its CI job
// (ci.yml: workspace-quality) was unreachable for months, which means the
// release gate was the only thing standing between a broken Site Admin
// surface and a deploy — and it wasn't checking. Run those two checks here.
const WORKSPACE_DIR = "apps/workspace";

const CHECKS = [
  ["public web contracts", "npm", ["run", "check:public-web"]],
  ["tests", "npm", ["run", "test"]],
  ["lint", "npm", ["run", "lint"]],
  ["script syntax", "npm", ["run", "check:scripts"]],
  ["workspace types", "npm", ["run", "typecheck"], { cwd: WORKSPACE_DIR }],
  ["workspace tests", "npm", ["run", "test"], { cwd: WORKSPACE_DIR }],
];

function parseArgs(argv = process.argv.slice(2)) {
  const rawEnv =
    argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ||
    "staging";
  const env = ENVIRONMENTS.has(rawEnv) ? rawEnv : "staging";
  const rawContentEnv = argv
    .find((arg) => arg.startsWith("--content-env="))
    ?.slice("--content-env=".length);
  const contentEnv = rawContentEnv && ENVIRONMENTS.has(rawContentEnv) ? rawContentEnv : "";
  return {
    env,
    contentEnv,
    dryRun: argv.includes("--dry-run"),
    skipChecks: argv.includes("--skip-checks"),
    skipBuild: argv.includes("--skip-build"),
    skipUpload: argv.includes("--skip-upload"),
    skipVerify: argv.includes("--skip-verify"),
    // Per-SHA caches are honored by default. --no-cache forces a clean
    // re-run of CHECKS / build / verify even when a recent green pass
    // exists for the same HEAD. Set when something off-tree changed
    // (env var, .env file, wrangler config) and you want to retest from
    // scratch.
    noCache: argv.includes("--no-cache"),
    // Content is no longer auto-committed during normal code releases.
    // Use these only for the explicit "backup D1 content into git" recovery
    // path; routine Site Admin edits should stay in D1 Draft/Live.
    syncContentToGit: argv.includes("--sync-content-to-git"),
    autoCommitContent: argv.includes("--auto-commit-content"),
  };
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
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

function gitValue(args) {
  return run("git", args, { capture: true, label: `git ${args.join(" ")}` }).trim();
}

function gitOutput(args) {
  return run("git", args, { capture: true, label: `git ${args.join(" ")}` });
}

function parsePorcelainPath(line) {
  const path = String(line || "").slice(3).trim();
  const renameArrow = " -> ";
  return path.includes(renameArrow) ? path.split(renameArrow).at(-1).trim() : path;
}

function readGitState() {
  const sha = gitValue(["rev-parse", "HEAD"]);
  const branchRaw = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw === "HEAD" ? "detached" : branchRaw;
  const status = gitOutput(["status", "--porcelain"]);
  const dirtyFiles = status
    ? status
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parsePorcelainPath)
    : [];
  return {
    sha,
    branch,
    dirty: status.length > 0,
    dirtyFileCount: dirtyFiles.length,
    dirtyFiles,
  };
}

function evaluateProductionGuard(git) {
  const reasons = [];
  if (readEnv("CONFIRM_PRODUCTION_DEPLOY") !== "1") {
    reasons.push("CONFIRM_PRODUCTION_DEPLOY=1 is required");
  }
  const confirmedSha = readEnv("CONFIRM_PRODUCTION_SHA");
  if (!confirmedSha) {
    reasons.push(`CONFIRM_PRODUCTION_SHA=${git.sha} is required`);
  } else if (confirmedSha !== git.sha) {
    reasons.push(`CONFIRM_PRODUCTION_SHA does not match current HEAD ${git.sha}`);
  }
  if (git.dirty && readEnv("ALLOW_DIRTY_PRODUCTION") !== "1") {
    reasons.push("working tree is dirty; set ALLOW_DIRTY_PRODUCTION=1 only for an intentional emergency");
  }
  if (git.branch !== "main" && readEnv("ALLOW_NON_MAIN_PRODUCTION") !== "1") {
    reasons.push(`current branch is ${git.branch}, not main`);
  }
  return { ok: reasons.length === 0, reasons };
}

function parseWorkerVersionId(output) {
  const match = /Worker Version ID:\s*([0-9a-f-]+)/i.exec(output);
  return match ? match[1] : "";
}

function parseDeployJson(output) {
  const marker = '{\n  "ok"';
  const start = output.lastIndexOf(marker);
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uploadMessage(env, git, contentSha) {
  const dirty = git.dirty ? " dirty=1" : "";
  const content = contentSha || git.sha;
  // The deploy:cf:* guard parses code=/content=/contentBranch= tokens from
  // this message and refuses to deploy when the latest uploaded version
  // doesn't match the deploying source. code= remains the git SHA; content=
  // is the post-D1-dump content snapshot hash so content-only edits are
  // visible to production promotion preflight.
  return `Release upload (${env}) source=${content} branch=${git.branch} code=${git.sha} codeBranch=${git.branch} content=${content} contentBranch=${git.branch}${dirty}`;
}

function reportAndExit(report) {
  console.log(JSON.stringify(report, null, 2));
}

function appendReleaseHistory(entry) {
  // Local releases bypass the GitHub Actions Deployment row that used to
  // answer "did the last release succeed?". Keep the replacement audit
  // local under .cache so routine releases do not create git churn.
  try {
    fs.mkdirSync(path.dirname(RELEASE_HISTORY_PATH), { recursive: true });
    const line = `${JSON.stringify({ ...entry, recordedAt: new Date().toISOString() })}\n`;
    fs.appendFileSync(RELEASE_HISTORY_PATH, line, "utf8");
  } catch (error) {
    // Audit logging must not block a release. Surface to stderr and
    // continue — the release outcome is still printed via reportAndExit.
    console.error(
      `[release-cloudflare] failed to append release history: ${error?.message || error}`,
    );
  }
}

function packBuildArtifacts({ repoRoot, artifactRoot, sha }) {
  // Snapshot the built worker bundle to `.cache/release/build/<sha>/`
  // so a same-SHA promotion can restore it instead of paying for a full
  // `npm run build:cf` again. Uses `cp -R` for speed; APFS clones the
  // inodes so this is effectively free disk-wise on macOS.
  const cacheDir = path.join(repoRoot, ".cache", "release", BUILD_CACHE_BUCKET, sha);
  fs.mkdirSync(cacheDir, { recursive: true });
  const captured = [];
  for (const rel of BUILD_CACHE_PATHS) {
    const src = path.join(artifactRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(cacheDir, rel);
    fs.rmSync(dst, { recursive: true, force: true });
    const result = spawnSync("cp", ["-R", src, dst], { stdio: "ignore" });
    if (result.status === 0) captured.push(rel);
  }
  return captured;
}

function restoreBuildArtifacts({ repoRoot, artifactRoot, sha }) {
  const cacheDir = path.join(repoRoot, ".cache", "release", BUILD_CACHE_BUCKET, sha);
  if (!fs.existsSync(cacheDir)) return [];
  const restored = [];
  for (const rel of BUILD_CACHE_PATHS) {
    const src = path.join(cacheDir, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(artifactRoot, rel);
    fs.rmSync(dst, { recursive: true, force: true });
    const result = spawnSync("cp", ["-R", src, dst], { stdio: "ignore" });
    if (result.status === 0) restored.push(rel);
  }
  return restored;
}

function buildCacheContentMatches(marker, expectedContentSha) {
  const expected = String(expectedContentSha || "").trim().toLowerCase();
  if (!expected) return true;
  return String(marker?.contentSnapshotSha || "").trim().toLowerCase() === expected;
}

function dumpD1Content({ targetRoot, env, label }) {
  const target = path.join(targetRoot, "content");
  console.log(
    `[release-cloudflare] syncing ${env} D1 content into ${path.relative(ROOT, target) || "content"}`,
  );
  run(
    "node",
    [
      "scripts/content/dump-content-from-db.mjs",
      "--remote",
      `--env=${env}`,
      "--quiet",
      `--target=${target}`,
    ],
    { label: label || `dump ${env} D1 to release snapshot content/`, cwd: ROOT },
  );
}

function hashReleaseContent(root) {
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

function autoCommitContentDrift({ git, env: targetEnv }) {
  // Only safe on main: the release rewrites `content/*` from D1 and we
  // stage only those files, leaving unrelated in-progress work alone.
  if (targetEnv !== "staging") return { committed: false, reason: "not-staging" };
  if (git.branch !== "main") {
    return { committed: false, reason: `not on main (branch=${git.branch})` };
  }
  const allDirty = gitOutput(["status", "--porcelain"]);
  if (!allDirty) return { committed: false, reason: "clean tree" };
  const dirtyFiles = allDirty
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePorcelainPath);
  const contentDirty = dirtyFiles.filter((file) => file.startsWith("content/"));
  if (contentDirty.length === 0) return { committed: false, reason: "no content drift" };
  try {
    run("git", ["add", "--", "content"], { label: "git add content/" });
    run(
      "git",
      [
        "commit",
        "-m",
        `chore(content): sync staging D1 → main (auto, after release ${git.sha.slice(0, 12)})`,
      ],
      { label: "git commit content/" },
    );
    const newSha = gitValue(["rev-parse", "HEAD"]);
    // Push is best-effort. Failure is recoverable (operator can `git push`
    // manually) but we surface it loudly so they don't ship the next
    // release before this commit lands upstream.
    let pushed = false;
    let pushError = "";
    try {
      run("git", ["push"], { label: "git push" });
      pushed = true;
    } catch (error) {
      pushError = error?.message || String(error);
    }
    return {
      committed: true,
      newSha,
      files: contentDirty,
      pushed,
      pushError,
    };
  } catch (error) {
    return { committed: false, reason: `git commit failed: ${error?.message || error}` };
  }
}

function clearContentOverlayAfterCodeDeploy(env) {
  console.log(
    `[release-cloudflare] clearing ${env} content overlay after full code deploy`,
  );
  try {
    const output = run(
      "node",
      [
        "scripts/content/publish-content.mjs",
        `--env=${env}`,
        "--clear",
        "--skip-verify",
      ],
      {
        capture: true,
        label: `publish-content clear ${env}`,
        cwd: ROOT,
      },
    );
    return parseDeployJson(output) || null;
  } catch (error) {
    const message = error?.message || String(error);
    console.warn(
      `[release-cloudflare] warning: could not clear ${env} content overlay after code deploy: ${message}`,
    );
    return { ok: false, error: message };
  }
}

async function fetchProductionVersionForRollback({ git }) {
  // The previous behavior required the operator to set
  // RELEASE_EXPECT_PRODUCTION_VERSION (release-from-staging.mjs does
  // this; direct `release:prod` invocations didn't). Without it
  // auto-rollback was silently disabled. Self-fetch the active
  // production version BEFORE deploying so the rollback target is
  // always set regardless of how the script was invoked.
  const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
  const apiToken = readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
  const workerName =
    readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION") || readEnv("CLOUDFLARE_WORKER_NAME");
  if (!accountId || !apiToken || !workerName) return null;
  try {
    const active = await readActiveDeployment({ accountId, apiToken, workerName });
    if (!active?.versionId) return null;
    const codeSha = effectiveCodeSha(active.meta);
    console.log(
      `[release-cloudflare] auto-rollback target prefetched: versionId=${active.versionId}${codeSha ? ` code=${codeSha.slice(0, 12)}` : ""}`,
    );
    return { versionId: active.versionId, codeSha };
  } catch (error) {
    console.error(
      `[release-cloudflare] could not pre-fetch production version (auto-rollback may not engage): ${error?.message || error}. Operator can still set RELEASE_EXPECT_PRODUCTION_VERSION manually. (HEAD=${git.sha.slice(0, 12)})`,
    );
    return null;
  }
}

function evaluateStagingDirtyGuard(git) {
  const reasons = [];
  if (readEnv("ALLOW_DIRTY_STAGING") === "1") return { ok: true, reasons };
  if (!git.dirty) return { ok: true, reasons };
  const dirtyContent = git.dirtyFiles.filter((file) => file.startsWith("content/"));
  if (dirtyContent.length === 0) return { ok: true, reasons };
  reasons.push(
    `content/ is dirty (${dirtyContent.length} file${dirtyContent.length === 1 ? "" : "s"})`,
  );
  if (dirtyContent.includes("content/filesystem/site-config.json")) {
    reasons.push(
      "content/filesystem/site-config.json is release-owned; put local-only settings in content/local/site-config.json instead",
    );
  }
  return { ok: false, reasons };
}

// Env vars whose CLI-set value must survive loadProjectEnv({override:true}) —
// i.e. the caller wants to opt into db mode (or a different DB env) for a
// single release without editing .env. Without this, shell exports of these
// keys get silently clobbered by .env defaults.
const CLI_ENV_OVERRIDES = [
  "SITE_ADMIN_STORAGE",
  "SITE_ADMIN_DB_ENV",
  "SITE_ADMIN_DB_LOCATION",
];

async function main() {
  const args = parseArgs();
  const cliEnv = {};
  for (const key of CLI_ENV_OVERRIDES) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      cliEnv[key] = process.env[key];
    }
  }
  loadProjectEnv({ cwd: ROOT, override: true });
  Object.assign(process.env, cliEnv);

  // The operator-facing source of truth is staging D1 by default. Operators
  // may pass --content-env=production when staging D1 is temporarily
  // unreadable; keep every nested build/prebuild step on that same source.
  process.env.SITE_ADMIN_STORAGE = "db";
  args.contentEnv = args.contentEnv || process.env.SITE_ADMIN_DB_ENV || "staging";
  process.env.SITE_ADMIN_DB_ENV = args.contentEnv;
  if (!process.env.SITE_ADMIN_DB_LOCATION) process.env.SITE_ADMIN_DB_LOCATION = "remote";

  // Legacy sync-to-git mode rewrites root `content/*` from D1. Keep the old
  // guard there so it cannot silently clobber hand edits. The default path
  // builds from a throwaway snapshot, so root content changes are ignored.
  if (args.env === "staging" && !args.skipBuild && !args.dryRun && args.syncContentToGit) {
    const dirty = gitValue([
      "status",
      "--porcelain",
      "--",
      "content",
    ]);
    if (dirty && readEnv("ALLOW_DIRTY_CONTENT") !== "1") {
      const files = dirty
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(3).trim());
      console.error(
        "[release-cloudflare] refusing to start: content/ has uncommitted changes that the D1 dump would overwrite:",
      );
      for (const file of files) console.error(`  - ${file}`);
      console.error(
        "Commit / stash these first, or pass ALLOW_DIRTY_CONTENT=1 to proceed (the dump will clobber them).",
      );
      process.exit(1);
    }
  }

  let contentDriftFromGit = null;
  let contentAutoCommit = null;

  if (args.env === "staging" && !args.skipBuild && !args.dryRun && args.syncContentToGit) {
    dumpD1Content({
      targetRoot: ROOT,
      env: args.contentEnv,
      label: `dump ${args.contentEnv} D1 to root content/`,
    });
    const syncGit = readGitState();
    const dirtyContent = syncGit.dirtyFiles.filter((file) => file.startsWith("content/"));
    if (dirtyContent.length > 0) {
      contentDriftFromGit = dirtyContent;
      if (args.autoCommitContent) {
        contentAutoCommit = autoCommitContentDrift({ git: syncGit, env: args.env });
        if (contentAutoCommit.committed) {
          console.log(
            `[release-cloudflare] auto-committed D1 content before build → ${contentAutoCommit.newSha.slice(0, 12)}${contentAutoCommit.pushed ? " (pushed)" : ` (push failed: ${contentAutoCommit.pushError})`}`,
          );
        } else {
          console.log(
            `[release-cloudflare] skipped prebuild auto-commit (${contentAutoCommit.reason})`,
          );
        }
      }
    }
  }

  let git = readGitState();
  const stagingDirtyGuard =
    args.env === "staging" && args.syncContentToGit
      ? evaluateStagingDirtyGuard(git)
      : args.env === "staging"
        ? { ok: true, reasons: [] }
        : null;
  const productionGuard = args.env === "production" ? evaluateProductionGuard(git) : null;
  const releaseWorkspace = createReleaseWorkspacePlan({
    env: args.env,
    contentEnv: args.contentEnv,
    skipBuild: args.skipBuild,
    syncContentToGit: args.syncContentToGit,
    reuseStagingBuild: readEnv("RELEASE_REUSE_STAGING_BUILD") === "1",
  });
  const expectedProductionVersionFromShell =
    readEnv("RELEASE_EXPECT_PRODUCTION_VERSION") ||
    readEnv("VERIFY_CF_EXPECT_PRODUCTION_VERSION");

  const baseReport = {
    ok: true,
    env: args.env,
    dryRun: args.dryRun,
    source: git,
    productionGuard,
    stagingDirtyGuard,
    releaseWorkspace,
    releaseRoot: null,
  };

  if (args.dryRun) {
    reportAndExit({
      ...baseReport,
      wouldRun: [
        ...(args.skipChecks ? [] : CHECKS.map(([name]) => name)),
        ...(releaseWorkspace.requiresCachedBuild
          ? ["restore verified cached build artifacts"]
          : ["build:cf"]),
        ...(args.skipUpload ? [] : ["wrangler versions upload"]),
        "deploy:cf",
        ...(args.skipVerify ? [] : ["verify:cf"]),
      ],
    });
    return;
  }

  if (productionGuard && !productionGuard.ok) {
    reportAndExit({ ...baseReport, ok: false });
    process.exitCode = 1;
    return;
  }
  if (stagingDirtyGuard && !stagingDirtyGuard.ok) {
    reportAndExit({ ...baseReport, ok: false });
    process.exitCode = 1;
    return;
  }

  const releaseRoot = prepareImmutableReleaseSnapshot({
    repoRoot: ROOT,
    sha: git.sha,
    environment: args.env,
    dependencyRoots: ["", WORKSPACE_DIR],
  });
  console.log(
    `[release-cloudflare] using committed HEAD from immutable snapshot ${path.relative(ROOT, releaseRoot)}${git.dirty ? `; excluded ${git.dirtyFileCount} working-tree change${git.dirtyFileCount === 1 ? "" : "s"}` : ""}`,
  );
  if (releaseWorkspace.hydrateContentFromD1) {
    dumpD1Content({
      targetRoot: releaseRoot,
      env: args.contentEnv,
      label: `dump ${args.contentEnv} D1 to release snapshot content/`,
    });
  }

  const checksRun = [];
  let checksCached = false;
  if (!args.skipChecks) {
    const marker = args.noCache
      ? null
      : readMarker({
          repoRoot: ROOT,
          bucket: CHECKS_CACHE_BUCKET,
          sha: git.sha,
          maxAgeMs: CHECKS_CACHE_TTL_MS,
        });
    // A marker written before a check was added to CHECKS proves nothing
    // about that check, so treat a narrower cached set as a miss.
    const cached =
      marker && CHECKS.every(([name]) => (marker.checks || []).includes(name))
        ? marker
        : null;
    if (cached) {
      const ageMin = Math.round((Date.now() - cached._writtenAtMs) / 60000);
      console.log(
        `[release-cloudflare] reusing CHECKS cache for ${git.sha.slice(0, 12)} (${ageMin}m old, ran: ${(cached.checks || []).join(", ")}). Pass --no-cache to re-run.`,
      );
      checksCached = true;
    } else {
      // A sub-project check is only meaningful with its own deps present, so
      // fail loudly rather than skip — a silent skip is how the workspace went
      // unchecked in the first place. Preflight all of them before the first
      // check runs; discovering a missing install after ~10 minutes of root
      // lint/test costs the operator the whole gate.
      for (const [name, , , options] of CHECKS) {
        if (!options?.cwd) continue;
        if (fs.existsSync(path.join(releaseRoot, options.cwd, "node_modules"))) continue;
        throw new Error(
          `${name} cannot run: ${options.cwd}/node_modules is missing. Run \`npm ci --prefix ${options.cwd}\` first.`,
        );
      }
      for (const [name, command, commandArgs, options] of CHECKS) {
        const checkCwd = options?.cwd
          ? path.join(releaseRoot, options.cwd)
          : releaseRoot;
        console.log(`[release-cloudflare] running ${name}`);
        run(command, commandArgs, { label: name, cwd: checkCwd });
        checksRun.push(name);
      }
      // Only write the marker when we successfully ran the *full* CHECKS
      // list. A partial run (e.g. one item failed mid-loop) wouldn't
      // reach here because run() throws on non-zero exit.
      writeMarker({
        repoRoot: ROOT,
        bucket: CHECKS_CACHE_BUCKET,
        sha: git.sha,
        payload: {
          checks: CHECKS.map(([name]) => name),
          dirty: git.dirty,
          branch: git.branch,
        },
      });
    }
  }

  let uploadedVersionId = null;
  let didRunBuild = false;
  let resolvedContentSourceMode = releaseWorkspace.contentSourceMode;
  let buildCache = {
    attempted: false,
    hit: false,
    restored: [],
    reason: "",
    expectedContentSha: readEnv("RELEASE_EXPECT_CONTENT_SHA"),
    storedContentSha: "",
  };

  if (args.skipBuild) {
    if (!buildCache.expectedContentSha) {
      throw new Error(
        "--skip-build requires RELEASE_EXPECT_CONTENT_SHA so cached code and content can both be verified. Re-run without --skip-build when no expected content SHA is available.",
      );
    }
    const cached = args.noCache
      ? null
      : readMarker({
          repoRoot: ROOT,
          bucket: BUILD_CACHE_BUCKET,
          sha: git.sha,
          maxAgeMs: BUILD_CACHE_TTL_MS,
        });
    if (!cached) {
      throw new Error(
        `--skip-build requires a recent immutable build cache for ${git.sha}. Re-run without --skip-build.`,
      );
    }
    if (!buildCacheContentMatches(cached, buildCache.expectedContentSha)) {
      throw new Error(
        `--skip-build cache content mismatch: cache=${cached.contentSnapshotSha || "unknown"} expected=${buildCache.expectedContentSha || "unspecified"}`,
      );
    }
    const restored = restoreBuildArtifacts({
      repoRoot: ROOT,
      artifactRoot: releaseRoot,
      sha: git.sha,
    });
    const missing = BUILD_CACHE_PATHS.filter((entry) => !restored.includes(entry));
    if (missing.length > 0) {
      throw new Error(
        `--skip-build cache is incomplete for ${git.sha}; missing ${missing.join(", ")}. Re-run without --skip-build.`,
      );
    }
    buildCache = {
      ...buildCache,
      attempted: true,
      hit: true,
      restored,
      reason: "required by --skip-build",
      storedContentSha: String(cached.contentSnapshotSha || ""),
    };
    resolvedContentSourceMode = `${cached.env || "unknown"}-immutable-build-cache`;
    console.log(
      `[release-cloudflare] restored immutable build cache for ${git.sha.slice(0, 12)} (${restored.join(", ")})`,
    );
  } else {
    let restored = [];
    const requirePromotedArtifact =
      args.env === "production" && readEnv("RELEASE_REUSE_STAGING_BUILD") === "1";
    if (requirePromotedArtifact && !buildCache.expectedContentSha) {
      throw new Error(
        "Production promotion requires RELEASE_EXPECT_CONTENT_SHA from the verified staging deployment.",
      );
    }
    const allowBuildCacheRead =
      requirePromotedArtifact || readEnv("ALLOW_D1_BUILD_CACHE") === "1";
    const cached = args.noCache || !allowBuildCacheRead
      ? null
      : readMarker({
          repoRoot: ROOT,
          bucket: BUILD_CACHE_BUCKET,
          sha: git.sha,
          maxAgeMs: BUILD_CACHE_TTL_MS,
        });
    buildCache = {
      ...buildCache,
      attempted: allowBuildCacheRead && !args.noCache,
      reason: args.noCache
        ? "disabled by --no-cache"
        : allowBuildCacheRead
          ? ""
          : "not requested",
      storedContentSha: String(cached?.contentSnapshotSha || ""),
    };
    const cachedContentMatches =
      cached && buildCacheContentMatches(cached, buildCache.expectedContentSha);
    if (cachedContentMatches) {
      restored = restoreBuildArtifacts({
        repoRoot: ROOT,
        artifactRoot: releaseRoot,
        sha: git.sha,
      });
    } else if (cached) {
      buildCache.reason = `content mismatch: cache=${cached.contentSnapshotSha || "unknown"} expected=${buildCache.expectedContentSha || "unspecified"}`;
    }
    const missingCachedArtifacts = BUILD_CACHE_PATHS.filter(
      (entry) => !restored.includes(entry),
    );
    if (requirePromotedArtifact && missingCachedArtifacts.length > 0) {
      const detail = cached
        ? cachedContentMatches
          ? `cache is incomplete; missing ${missingCachedArtifacts.join(", ")}`
          : `content mismatch: cache=${cached.contentSnapshotSha || "unknown"} expected=${buildCache.expectedContentSha}`
        : args.noCache
          ? "cache reads were disabled by --no-cache"
          : "no recent staging build cache exists";
      throw new Error(
        `Production promotion requires the exact verified staging artifact for code ${git.sha} and content ${buildCache.expectedContentSha}; ${detail}. Deploy staging on this runner, then retry promotion.`,
      );
    }
    if (missingCachedArtifacts.length === 0) {
      const ageMin = Math.round((Date.now() - cached._writtenAtMs) / 60000);
      buildCache = { ...buildCache, hit: true, restored, reason: "matched code and content" };
      resolvedContentSourceMode = `${cached.env || "unknown"}-immutable-build-cache`;
      console.log(
        `[release-cloudflare] reusing build:cf cache for ${git.sha.slice(0, 12)} (${ageMin}m old, restored: ${restored.join(", ")}). Pass --no-cache to rebuild.`,
      );
    } else {
      if (cachedContentMatches && !buildCache.reason) {
        buildCache.reason = `cache marker matched but build artifacts were missing: ${missingCachedArtifacts.join(", ")}`;
      }
      console.log("[release-cloudflare] running build:cf");
      run("npm", ["run", "build:cf"], { label: "build:cf", cwd: releaseRoot });
      didRunBuild = true;
    }
  }

  const filesystemContentSnapshotSha = hashReleaseContent(releaseRoot) || git.sha;
  const contentSnapshotSha =
    buildCache.hit && buildCache.storedContentSha
      ? buildCache.storedContentSha
      : filesystemContentSnapshotSha;
  console.log(
    `[release-cloudflare] content snapshot ${contentSnapshotSha.slice(0, 12)}`,
  );

  if (!args.skipBuild && (args.env === "staging" || readEnv("ALLOW_D1_BUILD_CACHE") === "1")) {
    const captured = packBuildArtifacts({
      repoRoot: ROOT,
      artifactRoot: releaseRoot,
      sha: git.sha,
    });
    if (captured.length > 0) {
      writeMarker({
        repoRoot: ROOT,
        bucket: BUILD_CACHE_BUCKET,
        sha: git.sha,
        payload: {
          paths: captured,
          branch: git.branch,
          contentSnapshotSha,
          env: args.env,
        },
      });
      buildCache = {
        ...buildCache,
        storedContentSha: contentSnapshotSha,
        reason: buildCache.hit ? buildCache.reason : `stored ${captured.join(", ")}`,
      };
      console.log(
        `[release-cloudflare] stored build:cf cache for ${git.sha.slice(0, 12)} content=${contentSnapshotSha.slice(0, 12)} (${captured.join(", ")})`,
      );
    }
  }

  if (!args.skipUpload) {
    console.log(`[release-cloudflare] uploading ${args.env} Worker version`);
    const uploadOutput = run(
      "npx",
      [
        "wrangler",
        "versions",
        "upload",
        "--env",
        args.env,
        "--message",
        uploadMessage(args.env, git, contentSnapshotSha),
      ],
      {
        capture: true,
        label: `wrangler versions upload --env ${args.env}`,
        cwd: releaseRoot,
      },
    );
    uploadedVersionId = parseWorkerVersionId(uploadOutput) || null;
  }

  console.log(`[release-cloudflare] deploying ${args.env}`);
  const deployScript = args.env === "production" ? "deploy:cf:prod" : "deploy:cf:staging";
  const deployEnv = {
    DEPLOY_SOURCE_SHA: git.sha,
    DEPLOY_SOURCE_BRANCH: git.branch,
    DEPLOY_CONTENT_SHA: contentSnapshotSha,
    DEPLOY_CONTENT_BRANCH: git.branch,
    DEPLOY_CODE_SHA: git.sha,
    DEPLOY_SOURCE_DIRTY: git.dirty ? "1" : "0",
  };
  const deployOutput = run("npm", ["run", deployScript], {
    capture: true,
    label: deployScript,
    env: deployEnv,
    cwd: releaseRoot,
  });
  const deployment = parseDeployJson(deployOutput);
  const overlayClear = clearContentOverlayAfterCodeDeploy(args.env);

  const verifies = [];
  // Auto-rollback target for production. The release:prod:from-staging
  // wrapper sets RELEASE_EXPECT_PRODUCTION_VERSION before invoking us;
  // direct `release:prod` invocations historically didn't, leaving
  // auto-rollback silently disabled. Self-fetch from CF as a fallback so
  // the rollback target is always populated regardless of how the
  // operator entered the script.
  let rollbackTarget =
    args.env === "production"
      ? readEnv("RELEASE_EXPECT_PRODUCTION_VERSION") ||
        readEnv("VERIFY_CF_EXPECT_PRODUCTION_VERSION") ||
        null
      : null;
  if (args.env === "production" && !rollbackTarget) {
    const prefetched = await fetchProductionVersionForRollback({ git });
    if (prefetched?.versionId) rollbackTarget = prefetched.versionId;
  }
  let rolledBack = null;

  if (!args.skipVerify) {
    const verifyScript = args.env === "production" ? "verify:cf:prod" : "verify:cf:staging";
    console.log(`[release-cloudflare] verifying ${args.env}`);
    try {
      run("npm", ["run", verifyScript], { label: verifyScript, cwd: releaseRoot });
      verifies.push(args.env);
      // Mark this SHA as "staging-verified" so release:prod:from-staging
      // can skip the heavier verify:staging:authenticated +
      // check:staging-visual gates within the TTL window. Production
      // verifies are not cached — promotion always re-checks production
      // independently.
      if (args.env === "staging") {
        writeMarker({
          repoRoot: ROOT,
          bucket: STAGING_VERIFY_BUCKET,
          sha: git.sha,
          payload: { verifyScript, ttlMs: STAGING_VERIFY_TTL_MS },
        });
      }
    } catch (verifyError) {
      // Production verify failed — the bad worker is already live. If we
      // know the pre-deploy version, roll it back automatically; the
      // operator will see the failure either way, but they shouldn't
      // have to fight a live regression while figuring out the version
      // ID. The rollback gets re-verified with the expected (rolled-to)
      // version so we don't claim success on a still-broken deploy.
      const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
      if (args.env === "production" && rollbackTarget && readEnv("DISABLE_AUTO_ROLLBACK") !== "1") {
        console.error(
          `[release-cloudflare] verify:cf:prod FAILED — rolling back to ${rollbackTarget}`,
        );
        try {
          run(
            "npx",
            [
              "wrangler",
              "rollback",
              "--env",
              "production",
              rollbackTarget,
              "--message",
              `auto-rollback after verify failure during release ${git.sha}`,
              "--yes",
            ],
            { label: "wrangler rollback --env production" },
          );
          run("npm", ["run", "verify:cf:prod"], {
            label: "verify:cf:prod (post-rollback)",
            env: { VERIFY_CF_EXPECT_PRODUCTION_VERSION: rollbackTarget },
            cwd: releaseRoot,
          });
          rolledBack = {
            target: rollbackTarget,
            verifyFailureSummary: message.split("\n")[0]?.slice(0, 240) ?? message,
          };
          console.error(
            `[release-cloudflare] auto-rolled-back to ${rollbackTarget}; original verify error above`,
          );
        } catch (rollbackError) {
          const rbMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          console.error(
            `[release-cloudflare] auto-rollback ALSO FAILED — production is in an unknown state. Original verify error: ${message}. Rollback error: ${rbMsg}`,
          );
        }
      } else if (args.env === "production" && !rollbackTarget) {
        console.error(
          "[release-cloudflare] verify:cf:prod failed but no rollback target was provided (RELEASE_EXPECT_PRODUCTION_VERSION). Manual rollback required — production-version-history.md has the previous version id.",
        );
      } else if (args.env === "production" && readEnv("DISABLE_AUTO_ROLLBACK") === "1") {
        console.error(
          `[release-cloudflare] verify:cf:prod failed; auto-rollback DISABLED via DISABLE_AUTO_ROLLBACK=1. Rollback target was ${rollbackTarget}.`,
        );
      }
      throw verifyError;
    }

    const expectedProductionVersion =
      expectedProductionVersionFromShell ||
      readEnv("RELEASE_EXPECT_PRODUCTION_VERSION") ||
      readEnv("VERIFY_CF_EXPECT_PRODUCTION_VERSION");
    if (args.env === "staging" && expectedProductionVersion) {
      console.log("[release-cloudflare] verifying production remained unchanged");
      run("npm", ["run", "verify:cf:prod"], {
        label: "verify:cf:prod",
        env: { VERIFY_CF_EXPECT_PRODUCTION_VERSION: expectedProductionVersion },
        cwd: releaseRoot,
      });
      verifies.push("production");
    }
  }

  if (
    args.env === "staging" &&
    !args.skipBuild &&
    args.syncContentToGit &&
    releaseRoot !== ROOT
  ) {
    dumpD1Content({
      targetRoot: ROOT,
      env: args.contentEnv,
      label: `dump ${args.contentEnv} D1 to root content/`,
    });
  }

  const finalReport = {
    ...baseReport,
    source: git,
    releaseRoot,
    checksRun,
    checksCached,
    buildRun: didRunBuild,
    buildCache,
    contentSnapshotSha,
    uploadedVersionId,
    deployedVersionId: deployment?.versionId || null,
    deploymentId: deployment?.deploymentId || null,
    deploymentMessage: deployment?.message || null,
    verified: verifies,
    contentDriftFromGit,
    contentAutoCommit,
    contentSourceMode: resolvedContentSourceMode,
    rolledBack,
    rollbackTarget: args.env === "production" ? rollbackTarget : null,
    overlayClear,
  };
  // Audit log — replaces the GitHub Deployment row that the local path
  // bypasses. JSONL keeps it auditable + grep-able without creating git
  // churn for routine releases.
  appendReleaseHistory({
    env: args.env,
    sha: git.sha,
    branch: git.branch,
    dirty: git.dirty,
    deployedVersionId: deployment?.versionId || null,
    deploymentId: deployment?.deploymentId || null,
    verified: verifies,
    rolledBack: rolledBack || null,
    contentAutoCommit: contentAutoCommit && contentAutoCommit.committed
      ? { newSha: contentAutoCommit.newSha, pushed: contentAutoCommit.pushed }
      : null,
    overlayClear,
    checksCached,
  });
  try {
    removeImmutableReleaseSnapshot({ repoRoot: ROOT, snapshotRoot: releaseRoot });
  } catch (error) {
    console.error(
      `[release-cloudflare] warning: could not remove release snapshot: ${error?.message || error}`,
    );
  }
  reportAndExit(finalReport);
}

main().catch((error) => {
  // Best-effort failure record. We don't have a fully-populated report
  // here (the throw may have happened mid-flight), but a "release X
  // failed" line is still more useful than silence — operators can pair
  // it with the stderr above to reconstruct what happened.
  try {
    const env = process.argv
      .find((arg) => arg.startsWith("--env="))
      ?.slice("--env=".length) || "staging";
    const sha = (() => {
      const result = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return String(result.stdout || "").trim() || "unknown";
    })();
    appendReleaseHistory({
      env,
      sha,
      failure: String(error?.message || error).split("\n")[0]?.slice(0, 240) ?? "unknown",
    });
  } catch {
    // never block the actual error from being printed
  }
  console.error(error?.stack || String(error));
  process.exit(1);
});
