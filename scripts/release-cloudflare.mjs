#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "./load-project-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENVIRONMENTS = new Set(["staging", "production"]);

const CHECKS = [
  ["public web contracts", "npm", ["run", "check:public-web"]],
  ["tests", "npm", ["run", "test"]],
  ["lint", "npm", ["run", "lint"]],
  ["script syntax", "npm", ["run", "check:scripts"]],
];

function parseArgs(argv = process.argv.slice(2)) {
  const rawEnv =
    argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ||
    "staging";
  const env = ENVIRONMENTS.has(rawEnv) ? rawEnv : "staging";
  return {
    env,
    dryRun: argv.includes("--dry-run"),
    skipChecks: argv.includes("--skip-checks"),
    skipBuild: argv.includes("--skip-build"),
    skipUpload: argv.includes("--skip-upload"),
    skipVerify: argv.includes("--skip-verify"),
  };
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function run(command, args, options = {}) {
  const capture = Boolean(options.capture);
  const result = spawnSync(command, args, {
    cwd: ROOT,
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

function readGitState() {
  const sha = gitValue(["rev-parse", "HEAD"]);
  const branchRaw = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw === "HEAD" ? "detached" : branchRaw;
  const status = gitValue(["status", "--porcelain"]);
  const dirtyFiles = status
    ? status
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
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

function uploadMessage(env, git) {
  const dirty = git.dirty ? " dirty=1" : "";
  // The deploy:cf:* guard parses code=/content=/contentBranch= tokens from
  // this message and refuses to deploy when the latest uploaded version
  // doesn't match the deploying source. Without overlay there's no separate
  // content branch, so code and content collapse onto the same git SHA.
  return `Release upload (${env}) source=${git.sha} branch=${git.branch} code=${git.sha} codeBranch=${git.branch} content=${git.sha} contentBranch=${git.branch}${dirty}`;
}

function reportAndExit(report) {
  console.log(JSON.stringify(report, null, 2));
}

function pickStagingContentRef() {
  return (
    readEnv("SITE_ADMIN_REPO_BRANCH_STAGING") ||
    readEnv("SITE_ADMIN_REPO_BRANCH") ||
    "site-admin-staging"
  );
}

function isGitShaLike(value) {
  return /^[a-f0-9]{7,40}$/i.test(String(value || "").trim());
}

function refreshStagingContentBranch(contentRef) {
  if (!contentRef || isGitShaLike(contentRef)) return;
  const remote = readEnv("SITE_ADMIN_REPO_REMOTE") || "origin";
  console.log(`[release-cloudflare] fetching staging content branch ${remote}/${contentRef}`);
  run("git", ["fetch", remote, `${contentRef}:${contentRef}`], {
    label: `git fetch ${remote} ${contentRef}:${contentRef}`,
  });
}

function shouldPromoteStagingContent(args) {
  return args.env === "production" && readEnv("PROMOTE_STAGING_CONTENT") === "1";
}

function evaluateStagingDirtyGuard(git) {
  const reasons = [];
  if (readEnv("ALLOW_DIRTY_STAGING") === "1") return { ok: true, reasons };
  if (!git.dirty) return { ok: true, reasons };
  reasons.push(
    `working tree is dirty (${git.dirtyFileCount} file${git.dirtyFileCount === 1 ? "" : "s"})`,
  );
  if (git.dirtyFiles.includes("content/filesystem/site-config.json")) {
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

  // Staging worker runs SITE_ADMIN_STORAGE=db (per wrangler.toml), so its
  // canonical content lives in D1, not in any git branch. Force the
  // prebuild into db mode for staging releases so D1 → content/* happens
  // automatically — without this, a developer whose local .env has
  // SITE_ADMIN_STORAGE=github (typical for working against the
  // GitHub-mode dev path) would otherwise build with stale on-disk
  // content and the staging site would visibly lag the workspace.
  // CI hits the same default via release-from-dispatch.yml's env block,
  // but this protects the local `npm run release:staging` path too.
  // Set `USE_GITHUB_OVERLAY=1` to opt back into the legacy site-admin-
  // staging-branch overlay flow.
  if (args.env === "staging" && readEnv("USE_GITHUB_OVERLAY") !== "1") {
    process.env.SITE_ADMIN_STORAGE = "db";
    if (!process.env.SITE_ADMIN_DB_ENV) process.env.SITE_ADMIN_DB_ENV = "staging";
    if (!process.env.SITE_ADMIN_DB_LOCATION) process.env.SITE_ADMIN_DB_LOCATION = "remote";
  }

  // The staging release rewrites `content/*` from D1 inside the prebuild
  // step. If the operator has uncommitted edits there (mid-experiment
  // file edit, hand-fixed bug), the dump silently overwrites them. Refuse
  // to start a release when the working tree has dirty content/ paths —
  // they should commit, stash, or pass `--allow-dirty-content` first.
  if (args.env === "staging" && !args.skipBuild && !args.dryRun) {
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

  const git = readGitState();
  const promoteStagingContent = shouldPromoteStagingContent(args);
  // SITE_ADMIN_STORAGE=db makes D1 the source of truth, so the git-branch
  // content overlay (designed for the GitHub-backed staging workflow) no
  // longer applies — the dump-from-d1 prebuild step will already have pulled
  // the right bytes into content/* before build:cf runs.
  const dbContentSource =
    String(process.env.SITE_ADMIN_STORAGE || "").trim().toLowerCase() === "db";
  const useContentOverlay =
    !dbContentSource && (args.env === "staging" || promoteStagingContent);
  const stagingDirtyGuard =
    args.env === "staging" ? evaluateStagingDirtyGuard(git) : null;
  const stagingContentRef = useContentOverlay ? pickStagingContentRef() : "";
  if (stagingContentRef) refreshStagingContentBranch(stagingContentRef);
  const stagingContentSha = stagingContentRef
    ? gitValue(["rev-parse", stagingContentRef])
    : "";
  const productionGuard = args.env === "production" ? evaluateProductionGuard(git) : null;
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
  };

  if (args.dryRun) {
    reportAndExit({
      ...baseReport,
      wouldRun: [
        ...(args.skipChecks ? [] : CHECKS.map(([name]) => name)),
        ...(useContentOverlay
          ? args.skipBuild && args.skipUpload
            ? []
            : ["content overlay build/upload"]
          : [
              ...(args.skipBuild ? [] : ["build:cf"]),
              ...(args.skipUpload ? [] : ["wrangler versions upload"]),
            ]),
        "deploy:cf",
        ...(args.skipVerify ? [] : ["verify:cf"]),
      ],
      ...(stagingContentRef
        ? { stagingContent: { ref: stagingContentRef, sha: stagingContentSha } }
        : {}),
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

  const checksRun = [];
  if (!args.skipChecks) {
    for (const [name, command, commandArgs] of CHECKS) {
      console.log(`[release-cloudflare] running ${name}`);
      run(command, commandArgs, { label: name });
      checksRun.push(name);
    }
  }

  let uploadedVersionId = null;
  let overlayRelease = null;

  if (useContentOverlay) {
    if (args.skipBuild && !args.skipUpload) {
      throw new Error(
        "Content-overlay release cannot upload without an overlay build. Use --skip-upload too, or run the release normally.",
      );
    }
    if (!args.skipBuild || !args.skipUpload) {
      console.log(`[release-cloudflare] running ${args.env} content-overlay build`);
      const overlayArgs = [
        "scripts/build-cloudflare-content-overlay.mjs",
        `--env=${args.env}`,
        `--code-ref=${git.sha}`,
        `--content-ref=${stagingContentRef}`,
        ...(args.skipBuild ? ["--skip-build"] : []),
        ...(args.skipUpload ? ["--skip-upload"] : []),
      ];
      const overlayOutput = run("node", overlayArgs, {
        capture: true,
        label: "staging content-overlay build/upload",
      });
      overlayRelease = parseDeployJson(overlayOutput);
      uploadedVersionId = overlayRelease?.uploadedVersionId || null;
    }
  } else if (!args.skipBuild) {
    console.log("[release-cloudflare] running build:cf");
    run("npm", ["run", "build:cf"], { label: "build:cf" });
  }

  if (!useContentOverlay && !args.skipUpload) {
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
        uploadMessage(args.env, git),
      ],
      { capture: true, label: `wrangler versions upload --env ${args.env}` },
    );
    uploadedVersionId = parseWorkerVersionId(uploadOutput) || null;
  }

  console.log(`[release-cloudflare] deploying ${args.env}`);
  const deployScript = args.env === "production" ? "deploy:cf:prod" : "deploy:cf:staging";
  const deployedContentSha = stagingContentSha || git.sha;
  const deployedContentBranch = stagingContentRef || git.branch;
  const deployEnv = {
    DEPLOY_SOURCE_SHA: deployedContentSha,
    DEPLOY_SOURCE_BRANCH: deployedContentBranch,
    DEPLOY_CONTENT_SHA: deployedContentSha,
    DEPLOY_CONTENT_BRANCH: deployedContentBranch,
    DEPLOY_CODE_SHA: git.sha,
    DEPLOY_SOURCE_DIRTY: git.dirty ? "1" : "0",
  };
  const deployOutput = run("npm", ["run", deployScript], {
    capture: true,
    label: deployScript,
    env: deployEnv,
  });
  const deployment = parseDeployJson(deployOutput);

  const verifies = [];
  // Auto-rollback target for production. If verify fails after a fresh
  // production deploy, we'll roll back to this version ID. The
  // release:prod:from-staging wrapper already captures the pre-deploy
  // version into RELEASE_EXPECT_PRODUCTION_VERSION; direct
  // `release:prod` invocations don't, so callers who want auto-rollback
  // through that path need to set the var themselves.
  const rollbackTarget =
    args.env === "production"
      ? readEnv("RELEASE_EXPECT_PRODUCTION_VERSION") ||
        readEnv("VERIFY_CF_EXPECT_PRODUCTION_VERSION") ||
        null
      : null;
  let rolledBack = null;

  if (!args.skipVerify) {
    const verifyScript = args.env === "production" ? "verify:cf:prod" : "verify:cf:staging";
    console.log(`[release-cloudflare] verifying ${args.env}`);
    try {
      run("npm", ["run", verifyScript], { label: verifyScript });
      verifies.push(args.env);
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
      });
      verifies.push("production");
    }
  }

  // The db-prebuild path rewrites content/* on disk to match D1. A
  // successful release that left content/ dirty means the workspace has
  // edits that aren't yet reflected in git — surface this so the
  // operator can commit on their next pass instead of discovering the
  // drift days later.
  let contentDriftFromGit = null;
  if (args.env === "staging" && !args.skipBuild) {
    try {
      const status = gitValue(["status", "--porcelain", "--", "content"]);
      if (status) {
        const files = status
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.slice(3).trim());
        contentDriftFromGit = files;
        console.log(
          `[release-cloudflare] content/ now differs from git (D1 dump pulled ${files.length} file${files.length === 1 ? "" : "s"} ahead). Commit to keep main synced:`,
        );
        console.log(`  git add ${files.map((f) => `'${f}'`).join(" ")}`);
        console.log(`  git commit -m "chore(content): sync from D1 staging"`);
        console.log(`  git push`);
      }
    } catch {
      // git status outside a working tree, etc. — just skip the hint.
    }
  }

  reportAndExit({
    ...baseReport,
    checksRun,
    buildRun: !args.skipBuild,
    overlayRelease,
    uploadedVersionId,
    deployedVersionId: deployment?.versionId || null,
    deploymentId: deployment?.deploymentId || null,
    deploymentMessage: deployment?.message || null,
    verified: verifies,
    contentDriftFromGit,
    rolledBack,
  });
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
