#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { materializePublicationSnapshot, readPublicationSnapshot } from "../_lib/publication-snapshot-files.mjs";
import { assertPublicationReady } from "../../lib/shared/publication-validation.ts";
import { readMarker, writeMarker } from "../_lib/release-cache.mjs";
import { verifyStagingRelease } from "../_lib/staging-release-verification.mjs";
import { hashContentInput, readPublishedBaseline, readTargetWorkerDeployment, prepareCodeOverlay, waitForWorkerVersion } from "../content/publish-content.mjs";
import { VERSIONED_OVERLAY_TAG } from "../../lib/shared/static-release.ts";
import {
  createReleaseWorkspacePlan,
  prepareImmutableReleaseSnapshot,
  removeImmutableReleaseSnapshot,
} from "../_lib/release-workspace.mjs";
import {
  acquireReleaseLock,
  formatHeldLock,
  recordRemoteReleaseHistory,
} from "../_lib/release-control-plane.mjs";
import {
  artifactStoreDisabled,
  uploadBuildArtifact,
} from "../_lib/release-artifact-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ENVIRONMENTS = new Set(["staging", "production"]);

// Per-SHA caches keep `release:staging` → `release:prod:from-staging`
// fast on the same HEAD without giving up the safety net of the next
// commit invalidating everything automatically. TTLs are conservative
// upper bounds — stop trusting a green pass after this much wall time.
const CHECKS_CACHE_BUCKET = "checks";
const CHECKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the verified staging artifact for audit, not production hydration.
const BUILD_CACHE_BUCKET = "build";
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

function gitRefContainsCommit(ref, commit) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", commit, ref], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
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
    publishedToOriginMain: gitRefContainsCommit("origin/main", sha),
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
  if (!git.publishedToOriginMain && readEnv("ALLOW_UNPUSHED_PRODUCTION") !== "1") {
    reasons.push(
      "current HEAD is not available on origin/main; push main before production so the release runner can rebuild this version",
    );
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
  return `Release upload (${env}) source=${content} branch=${git.branch} code=${git.sha} codeBranch=${git.branch} content=${content} contentBranch=${git.branch} ${VERSIONED_OVERLAY_TAG}${dirty}`;
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
  // Machine-independent copy in the shared control-plane D1, so the audit
  // trail and rollback pointers survive the machine that ran the release.
  // Best-effort, self-timeboxed, and never rejects — safe un-awaited.
  void recordRemoteReleaseHistory({
    root: ROOT,
    entry: { source: "release-cloudflare", ...entry },
  });
}

function copyTreeFast(src, dst) {
  // `cp -c` clones via APFS copyfile(2): cloning a multi-hundred-MB build
  // tree costs kilobytes of disk instead of a full copy. (The old plain
  // `cp -R` here silently ate a full artifact's worth of disk per SHA while
  // its comment claimed cloning.) Not every filesystem supports clones, so
  // fall back to a plain copy when the clone fails.
  if (process.platform === "darwin") {
    const clone = spawnSync("cp", ["-c", "-R", src, dst], { stdio: "ignore" });
    if (clone.status === 0) return true;
    fs.rmSync(dst, { recursive: true, force: true });
  }
  return spawnSync("cp", ["-R", src, dst], { stdio: "ignore" }).status === 0;
}

function packBuildArtifacts({ repoRoot, artifactRoot, sha }) {
  // Keep the verified build available for inspection and publication diagnostics.
  const cacheDir = path.join(repoRoot, ".cache", "release", BUILD_CACHE_BUCKET, sha);
  fs.mkdirSync(cacheDir, { recursive: true });
  const captured = [];
  for (const rel of BUILD_CACHE_PATHS) {
    const src = path.join(artifactRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(cacheDir, rel);
    fs.rmSync(dst, { recursive: true, force: true });
    if (copyTreeFast(src, dst)) captured.push(rel);
  }
  return captured;
}

function pruneBuildCache({ repoRoot, keepSha }) {
  // Per-SHA artifact dirs run 360-580MB and nothing ever deleted them.
  // Keep the newest few (always including the SHA just packed) and drop the
  // rest together with their markers.
  const keep = Math.max(1, Number(readEnv("RELEASE_BUILD_CACHE_KEEP") || 3));
  const bucketRoot = path.join(repoRoot, ".cache", "release", BUILD_CACHE_BUCKET);
  let entries = [];
  try {
    entries = fs
      .readdirSync(bucketRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{7,40}$/i.test(entry.name))
      .map((entry) => {
        const abs = path.join(bucketRoot, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(abs).mtimeMs;
        } catch {
          // Treat unreadable entries as oldest.
        }
        return { sha: entry.name, abs, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return 0;
  }
  const keepSet = new Set(entries.slice(0, keep).map((entry) => entry.sha));
  if (keepSha) keepSet.add(String(keepSha));
  let pruned = 0;
  for (const entry of entries) {
    if (keepSet.has(entry.sha)) continue;
    try {
      fs.rmSync(entry.abs, { recursive: true, force: true });
      fs.rmSync(path.join(bucketRoot, `${entry.sha}.json`), { force: true });
      pruned += 1;
    } catch (error) {
      console.warn(
        `[release-cloudflare] could not prune build cache ${entry.sha}: ${error?.message || error}`,
      );
    }
  }
  if (pruned > 0) {
    console.log(
      `[release-cloudflare] pruned ${pruned} old build cache entr${pruned === 1 ? "y" : "ies"} (keeping newest ${keep})`,
    );
  }
  return pruned;
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
      "--prune",
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

let heldReleaseLock = null;
let releaseSnapshotRoot = null;

async function main() {
  const args = parseArgs();
  const cliEnv = {};
  for (const key of CLI_ENV_OVERRIDES) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      cliEnv[key] = process.env[key];
    }
  }
  loadProjectEnv({ cwd: ROOT, override: true, files: [".env"] });
  Object.assign(process.env, cliEnv);

  // Only the explicit staging backup uses the draft D1.
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

  const git = readGitState();
  const stagingDirtyGuard =
    args.env === "staging" && args.syncContentToGit
      ? evaluateStagingDirtyGuard(git)
      : args.env === "staging"
        ? { ok: true, reasons: [] }
        : null;
  const productionGuard = args.env === "production" ? evaluateProductionGuard(git) : null;
  if (args.skipBuild || args.skipUpload || args.skipVerify) {
    throw new Error("Code releases require a fresh build, upload, and verification of the target's published snapshot.");
  }
  const releaseWorkspace = createReleaseWorkspacePlan({
    env: args.env,
    contentEnv: args.contentEnv,
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
        `pin ${args.env} published content baseline`,
        ...(args.skipChecks ? [] : CHECKS.map(([name]) => name)),
        "build:cf", "wrangler versions upload", "prepare and verify the inactive overlay generation",
        "activate the prepared Worker", "verify served content and search",
        ...(args.env === "staging" ? ["verify:staging:authenticated", "check:staging-visual"] : []),
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

  // Cross-process mutual exclusion for the whole release. The runner's
  // in-process claimGate cannot see a laptop CLI invocation of this same
  // script, and two releases racing over one Worker has happened before
  // (see TERMINAL_RELEASE_STATUSES in release-agent.mjs). Children spawned
  // below (deploy:cf, overlay restore, verify) inherit the lock.
  const lock = await acquireReleaseLock({
    root: ROOT,
    environment: args.env,
    operation: `release-cloudflare ${args.env} ${git.sha.slice(0, 12)}`,
  });
  if (!lock.ok) {
    console.error(`[release-cloudflare] ${formatHeldLock(lock.held)}`);
    reportAndExit({ ...baseReport, ok: false, lockHeldBy: lock.held });
    process.exitCode = 1;
    return;
  }
  heldReleaseLock = lock;

  const previousWorker = await readTargetWorkerDeployment(args.env, { allowMissing: true });
  const previousBaseline = await readPublishedBaseline(args.env, previousWorker);
  if (args.env === "production" && expectedProductionVersionFromShell && previousWorker?.versionId !== expectedProductionVersionFromShell) {
    throw new Error("Production changed after promotion preflight.");
  }
  if (previousWorker && !previousBaseline) {
    throw new Error(`${args.env} has no verified published content baseline. Recover it before releasing code; saved drafts are not a fallback.`);
  }

  const releaseRoot = prepareImmutableReleaseSnapshot({
    repoRoot: ROOT,
    sha: git.sha,
    environment: args.env,
    dependencyRoots: ["", WORKSPACE_DIR],
    copyRootDependencies: true,
  });
  releaseSnapshotRoot = releaseRoot;
  console.log(
    `[release-cloudflare] using committed HEAD from immutable snapshot ${path.relative(ROOT, releaseRoot)}${git.dirty ? `; excluded ${git.dirtyFileCount} working-tree change${git.dirtyFileCount === 1 ? "" : "s"}` : ""}`,
  );
  const pinnedBuildEnv = { CONTENT_SYNC_MODE: "stubs", SKIP_SYNC: "0", NEXT_BUILD_ID: "" };
  if (previousBaseline) {
    materializePublicationSnapshot(releaseRoot, previousBaseline);
    console.log(`[release-cloudflare] pinned ${args.env} published content ${previousBaseline.sha.slice(0, 12)}`);
  }
  const pinnedPublication = readPublicationSnapshot(releaseRoot);
  assertPublicationReady(pinnedPublication);
  const pinnedContentInputSha = hashContentInput(releaseRoot);
  run("npm", ["run", "prebuild"], { cwd: releaseRoot, env: pinnedBuildEnv });

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
        run(command, commandArgs, { label: name, cwd: checkCwd, env: pinnedBuildEnv });
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

  console.log("[release-cloudflare] building the pinned published release candidate");
  run("npm", ["run", "build:cf"], { label: "build:cf", cwd: releaseRoot, env: pinnedBuildEnv });
  if (readPublicationSnapshot(releaseRoot).sha !== pinnedPublication.sha) {
    throw new Error("Build changed the pinned published content. Refusing to upload.");
  }
  const contentSnapshotSha = hashReleaseContent(releaseRoot);
  console.log(`[release-cloudflare] content snapshot ${contentSnapshotSha.slice(0, 12)}`);

  const uploadOutput = run("npx", ["wrangler", "versions", "upload", "--env", args.env,
    "--message", uploadMessage(args.env, git, contentSnapshotSha)], {
    capture: true, label: `wrangler versions upload --env ${args.env}`, cwd: releaseRoot,
  });
  const uploadedVersionId = parseWorkerVersionId(uploadOutput);
  if (!uploadedVersionId) throw new Error("Could not identify uploaded Worker candidate.");
  const { verify, cleanup, ...codeOverlay } = await prepareCodeOverlay({
    env: args.env, releaseRoot, git, versionId: uploadedVersionId, publicationSha: pinnedPublication.sha,
    contentInputSha: pinnedContentInputSha,
  });

  const beforeActivation = await readTargetWorkerDeployment(args.env, { allowMissing: true });
  if (beforeActivation?.versionId !== previousWorker?.versionId ||
      beforeActivation?.deploymentId !== previousWorker?.deploymentId ||
      (await readPublishedBaseline(args.env, beforeActivation))?.sha !== previousBaseline?.sha) {
    throw new Error("The active Worker or published content changed during preparation; nothing was activated.");
  }

  const verifies = [];
  let deployment, stagingAcceptance;
  const rollbackTarget = previousWorker?.versionId || null;
  const deployScript = args.env === "production" ? "deploy:cf:prod" : "deploy:cf:staging";
  const verifyScript = args.env === "production" ? "verify:cf:prod" : "verify:cf:staging";
  try {
    console.log(`[release-cloudflare] activating verified ${args.env} Worker and content pair`);
    const deployOutput = run("npm", ["run", deployScript], {
      capture: true, label: deployScript, cwd: releaseRoot,
      env: {
        DEPLOY_EXPECT_VERSION_ID: uploadedVersionId,
        DEPLOY_SOURCE_SHA: git.sha, DEPLOY_SOURCE_BRANCH: git.branch,
        DEPLOY_CONTENT_SHA: contentSnapshotSha, DEPLOY_CONTENT_BRANCH: git.branch,
        DEPLOY_CODE_SHA: git.sha, DEPLOY_SOURCE_DIRTY: git.dirty ? "1" : "0",
      },
    });
    deployment = parseDeployJson(deployOutput);
    if (deployment?.versionId !== uploadedVersionId) throw new Error("Unexpected deployment response.");
    codeOverlay.serving = await verify();
    if (args.env === "staging") {
      stagingAcceptance = await verifyStagingRelease({
        root: ROOT,
        expected: {
          codeSha: git.sha, versionId: uploadedVersionId, artifactSha: contentSnapshotSha,
          publicationSha: codeOverlay.publicationSnapshotSha, overlaySha: codeOverlay.snapshotSha,
        },
        force: true, runCheck: (check) => run("npm", ["run", check], { label: check }),
      });
    } else {
      run("npm", ["run", verifyScript], {
        label: verifyScript, cwd: releaseRoot, env: { VERIFY_CF_EXPECT_PRODUCTION_VERSION: uploadedVersionId },
      });
    }
    verifies.push(args.env);
  } catch (error) {
    if (rollbackTarget && readEnv("DISABLE_AUTO_ROLLBACK") !== "1") {
      try {
        // Also covers a lost response after a successful Cloudflare activation.
        const active = await readTargetWorkerDeployment(args.env);
        if (active.versionId === uploadedVersionId) {
          run("npx", ["wrangler", "rollback", "--env", args.env, rollbackTarget,
            "--message", `Restore Worker and published content after release ${git.sha}`, "--yes"],
          { label: `rollback ${args.env}`, cwd: releaseRoot });
          const restored = await waitForWorkerVersion(args.env, rollbackTarget);
          if ((await readPublishedBaseline(args.env, restored))?.sha !== previousBaseline?.sha) {
            throw new Error("Rollback did not restore the original Worker and content pair.");
          }
          run("npm", ["run", verifyScript], { label: `${verifyScript} (post-rollback)`, cwd: releaseRoot,
            env: args.env === "production" ? { VERIFY_CF_EXPECT_PRODUCTION_VERSION: rollbackTarget } : {} });
          appendReleaseHistory({ env: args.env, sha: git.sha, deployedVersionId: rollbackTarget,
            publicationSnapshotSha: previousBaseline?.sha, note: "Restored the previous Worker and publication" });
          console.error(`[release-cloudflare] restored previous ${args.env} Worker and content ${rollbackTarget}`);
        }
      } catch (rollbackError) {
        throw new Error(`Release failed: ${error.message}. Rollback could not be verified: ${rollbackError.message}`, { cause: error });
      }
    }
    throw error;
  }
  await cleanup();

  // Keep a verified staging artifact for audit/inspection, not as a source of production content.
  if (args.env === "staging") {
    const paths = packBuildArtifacts({ repoRoot: ROOT, artifactRoot: releaseRoot, sha: git.sha });
    if (paths.length === BUILD_CACHE_PATHS.length) {
      const markerPayload = { paths, branch: git.branch, contentSnapshotSha, env: args.env };
      writeMarker({ repoRoot: ROOT, bucket: BUILD_CACHE_BUCKET, sha: git.sha, payload: markerPayload });
      pruneBuildCache({ repoRoot: ROOT, keepSha: git.sha });
      if (!artifactStoreDisabled()) uploadBuildArtifact({
        root: ROOT, codeSha: git.sha, contentSha: contentSnapshotSha,
        cacheDir: path.join(ROOT, ".cache", "release", BUILD_CACHE_BUCKET, git.sha), markerPayload,
      });
    }
    if (expectedProductionVersionFromShell) {
      run("npm", ["run", "verify:cf:prod"], { cwd: releaseRoot,
        env: { VERIFY_CF_EXPECT_PRODUCTION_VERSION: expectedProductionVersionFromShell } });
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
    buildRun: true,
    contentSnapshotSha,
    uploadedVersionId,
    deployedVersionId: deployment?.versionId || null,
    deploymentId: deployment?.deploymentId || null,
    deploymentMessage: deployment?.message || null,
    verified: verifies,
    contentDriftFromGit,
    contentAutoCommit,
    contentSourceMode: releaseWorkspace.contentSourceMode,
    rollbackTarget,
    codeOverlay,
    stagingAcceptance,
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
    contentAutoCommit: contentAutoCommit && contentAutoCommit.committed
      ? { newSha: contentAutoCommit.newSha, pushed: contentAutoCommit.pushed }
      : null,
    codeOverlay,
    stagingAcceptance,
    checksCached,
  });
  reportAndExit(finalReport);
}

main()
  .catch((error) => {
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
    // exitCode instead of exit(): the lock release and the in-flight remote
    // history write still need the event loop to drain.
    process.exitCode = 1;
  })
  .finally(async () => {
    if (releaseSnapshotRoot) {
      try { removeImmutableReleaseSnapshot({ repoRoot: ROOT, snapshotRoot: releaseSnapshotRoot }); }
      catch (error) { console.warn(`[release-cloudflare] release workspace cleanup warning: ${error.message}`); }
    }
    await heldReleaseLock?.release();
  });
