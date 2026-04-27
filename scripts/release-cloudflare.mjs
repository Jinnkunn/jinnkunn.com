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
  return {
    sha,
    branch,
    dirty: status.length > 0,
    dirtyFileCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
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
  return `Release upload (${env}) source=${git.sha} branch=${git.branch}${dirty}`;
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

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true });
  const git = readGitState();
  const stagingContentRef = args.env === "staging" ? pickStagingContentRef() : "";
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
  };

  if (args.dryRun) {
    reportAndExit({
      ...baseReport,
      wouldRun: [
        ...(args.skipChecks ? [] : CHECKS.map(([name]) => name)),
        ...(args.env === "staging"
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

  if (args.env === "staging") {
    if (args.skipBuild && !args.skipUpload) {
      throw new Error(
        "Staging release cannot upload without an overlay build. Use --skip-upload too, or run npm run release:staging normally.",
      );
    }
    if (!args.skipBuild || !args.skipUpload) {
      console.log("[release-cloudflare] running staging content-overlay build");
      const overlayArgs = [
        "scripts/build-cloudflare-content-overlay.mjs",
        "--env=staging",
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

  if (args.env !== "staging" && !args.skipUpload) {
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
  const deployEnv = {
    DEPLOY_SOURCE_SHA: args.env === "staging" ? stagingContentSha : git.sha,
    DEPLOY_SOURCE_BRANCH: args.env === "staging" ? stagingContentRef : git.branch,
    DEPLOY_CONTENT_SHA: args.env === "staging" ? stagingContentSha : git.sha,
    DEPLOY_CONTENT_BRANCH: args.env === "staging" ? stagingContentRef : git.branch,
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
  if (!args.skipVerify) {
    const verifyScript = args.env === "production" ? "verify:cf:prod" : "verify:cf:staging";
    console.log(`[release-cloudflare] verifying ${args.env}`);
    run("npm", ["run", verifyScript], { label: verifyScript });
    verifies.push(args.env);

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
  });
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
