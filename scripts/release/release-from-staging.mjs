#!/usr/bin/env node

// One-command production promotion. Replaces the multi-step manual
// dance (preflight → verify staging → set CONFIRM_PRODUCTION_DEPLOY=1
// → set CONFIRM_PRODUCTION_SHA=$sha → release:prod) with:
//
//   npm run release:prod:from-staging
//
// What it does, in order:
//
//   1. Read git state (must be on main, clean tree, fast-forwarded).
//   2. GET the staging Worker's active deployment from Cloudflare.
//   3. Parse the deployed version's annotation message and confirm
//      its `code=` SHA matches the local release-source HEAD. If staging is
//      behind, bail with a clear "release:staging first" message.
//   4. Read the current production version (so we can both record it
//      for rollback AND tell release:prod to verify it didn't drift
//      mid-release).
//   5. Run the heavy verifications (verify:staging:authenticated +
//      check:staging-visual). These were always recommended; we just
//      stop relying on the operator to remember.
//   6. Snapshot the about-to-be-replaced production version into
//      docs/runbooks/production-version-history.md.
//   7. Invoke `release:prod --skip-checks` with all confirmation env
//      vars pre-populated. We pass `--skip-checks` because staging
//      already proved the same code SHA passes lint/tests/etc.
//   8. Build against the active production publication, never drafts or
//      the staging artifact, and verify the complete candidate before switching.
//   9. After success, snapshot the new production version too — gives
//      a continuous history without an extra command.
//
// Override flags:
//   --skip-visual         Skip check:staging-visual (slow, requires Playwright)
//   --skip-authenticated  Skip verify:staging:authenticated
//   --note "message"      Recorded in the version history table
//   --dry-run             Print the plan; don't deploy

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { readActiveDeployment } from "../_lib/cloudflare-api.mjs";
import {
  compareDeploymentToReleaseSource,
  effectiveCodeSha,
} from "../_lib/deploy-metadata.mjs";
import { verifyStagingRelease } from "../_lib/staging-release-verification.mjs";
import {
  acquireReleaseLock,
  formatHeldLock,
} from "../_lib/release-control-plane.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function parseArgs(argv = process.argv.slice(2)) {
  let note = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else if (arg === "--note" && i + 1 < argv.length) {
      note = argv[i + 1];
      i += 1;
    }
  }
  return {
    dryRun: argv.includes("--dry-run"),
    skipVisual: argv.includes("--skip-visual"),
    skipAuthenticated: argv.includes("--skip-authenticated"),
    forceVerify: argv.includes("--force-verify"),
    note,
  };
}

const PRODUCTION_HISTORY_PATH = "docs/runbooks/production-version-history.md";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function readAccountId() {
  return readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
}

function readApiToken() {
  return readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
}

function readWorkerName(env) {
  if (env === "staging") {
    return (
      readEnv("CLOUDFLARE_WORKER_NAME_STAGING") ||
      readEnv("CLOUDFLARE_WORKER_NAME")
    );
  }
  return (
    readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION") ||
    readEnv("CLOUDFLARE_WORKER_NAME")
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
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

function readDirtyFiles() {
  const status = gitOutput(["status", "--porcelain"]);
  return status
    ? status.split(/\r?\n/).filter(Boolean).map(parsePorcelainPath)
    : [];
}

function isOnlyProductionHistoryDirty(files) {
  return files.length > 0 && files.every((file) => file === PRODUCTION_HISTORY_PATH);
}

function readGitState() {
  const sha = gitValue(["rev-parse", "HEAD"]);
  const branch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = gitOutput(["status", "--porcelain"]);
  return {
    sha,
    branch: branch === "HEAD" ? "detached" : branch,
    dirty: status.length > 0,
  };
}

function evaluatePreconditions({ git }) {
  const reasons = [];
  if (git.branch !== "main") {
    reasons.push(`current branch is ${git.branch}, not main`);
  }
  const dirtyFiles = git.dirty ? readDirtyFiles() : [];
  if (git.dirty && !isOnlyProductionHistoryDirty(dirtyFiles)) {
    reasons.push("working tree is dirty; commit or stash before promoting");
  }
  return { ok: reasons.length === 0, reasons, dirtyFiles };
}

function fail(message) {
  console.error(`[release-from-staging] ${message}`);
  process.exit(1);
}

let heldReleaseLock = null;
let heldStagingLock = null;

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true, files: [".env"] });

  const accountId = readAccountId();
  const apiToken = readApiToken();
  if (!accountId) fail("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!apiToken) fail("Missing CLOUDFLARE_API_TOKEN");
  const stagingWorker = readWorkerName("staging");
  const productionWorker = readWorkerName("production");
  if (!stagingWorker) fail("Missing CLOUDFLARE_WORKER_NAME_STAGING");
  if (!productionWorker) fail("Missing CLOUDFLARE_WORKER_NAME_PRODUCTION");

  const git = readGitState();
  console.log(
    `[release-from-staging] git: branch=${git.branch} sha=${git.sha} dirty=${git.dirty}`,
  );

  const pre = evaluatePreconditions({ git });
  if (!pre.ok) {
    if (args.dryRun) {
      // Dry-run is for previewing the plan during active development —
      // dirty trees and feature branches are common in that mode. Print
      // what would block a real run and continue so the operator still
      // sees the plan.
      console.log(
        `[release-from-staging] (dry-run) preconditions would block real release:`,
      );
      for (const reason of pre.reasons) {
        console.log(`  - ${reason}`);
      }
    } else {
      fail(`Preconditions failed:\n  - ${pre.reasons.join("\n  - ")}`);
    }
  }
  if (isOnlyProductionHistoryDirty(pre.dirtyFiles)) {
    console.log(
      `[release-from-staging] allowing existing production history audit log changes: ${PRODUCTION_HISTORY_PATH}`,
    );
  }

  console.log(`[release-from-staging] reading staging worker ${stagingWorker}…`);
  const staging = await readActiveDeployment({
    accountId,
    apiToken,
    workerName: stagingWorker,
  });
  if (!staging) {
    fail(`Staging worker ${stagingWorker} has no active deployment`);
  }
  // The release-cloudflare upload message embeds `code=<sha>`; that's the
  // value we compare against local HEAD. (Older deployments only had a
  // single `source=` token, in which case sourceSha is the codeSha.)
  const verdict = compareDeploymentToReleaseSource({ meta: staging.meta, sourceSha: git.sha });
  if (!verdict.ok) {
    if (verdict.code === "STAGING_METADATA_UNREADABLE") {
      fail(verdict.detail);
    } else if (args.dryRun) {
      const stagingCodeSha = effectiveCodeSha(staging.meta);
      console.log(`[release-from-staging] (dry-run) ${verdict.code}:\n${verdict.detail}`);
      console.log(
        JSON.stringify(
          {
            ok: false,
            dryRun: true,
            code: verdict.code,
            detail: verdict.detail,
            git,
            staging: {
              workerName: stagingWorker,
              versionId: staging.versionId,
              codeSha: stagingCodeSha,
            },
          },
          null,
          2,
        ),
      );
      return;
    } else {
      fail(verdict.detail);
    }
  }
  const stagingCodeSha = effectiveCodeSha(staging.meta);
  console.log(
    `[release-from-staging] staging matches release source: code=${stagingCodeSha} versionId=${staging.versionId}`,
  );

  console.log(`[release-from-staging] reading production worker ${productionWorker}…`);
  const production = await readActiveDeployment({
    accountId,
    apiToken,
    workerName: productionWorker,
  });
  const productionVersionId = production?.versionId || "";
  if (productionVersionId) {
    console.log(
      `[release-from-staging] current production version: ${productionVersionId}`,
    );
  } else {
    console.log(`[release-from-staging] production has no active deployment yet`);
  }

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          plan: {
            verifyStagingAuthenticated: !args.skipAuthenticated,
            checkStagingVisual: !args.skipVisual,
            snapshotPreviousProduction: Boolean(productionVersionId),
            releaseProd: {
              skipChecks: true,
              contentSource: "active production publication",
              verifyBeforeActivation: true,
              expectProductionVersion: productionVersionId || "(none)",
            },
            preserveProductionD1: true,
            publishSavedDrafts: false,
            snapshotNewProduction: true,
          },
          git,
          staging: {
            workerName: stagingWorker,
            versionId: staging.versionId,
            codeSha: stagingCodeSha,
          },
          production: {
            workerName: productionWorker,
            versionId: productionVersionId || null,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  // Hold the production lock across the entire promotion — verify, snapshot,
  // release:prod, and the overlay rebuild — so its child steps run as one
  // unit instead of each taking and releasing the lock with gaps in between.
  // The children inherit membership and skip their own acquisition.
  const lock = await acquireReleaseLock({
    root: ROOT,
    environment: "production",
    operation: `release-from-staging ${git.sha.slice(0, 12)}`,
  });
  if (!lock.ok) {
    console.error(`[release-from-staging] ${formatHeldLock(lock.held)}`);
    process.exitCode = 1;
    return;
  }
  heldReleaseLock = lock;

  // Hold the staging snapshot stable while verifying and promoting it.
  const stagingLock = await acquireReleaseLock({
    root: ROOT, environment: "staging", operation: `verify staging for promotion ${git.sha.slice(0, 12)}`,
  });
  if (!stagingLock.ok) {
    console.error(`[release-from-staging] ${formatHeldLock(stagingLock.held)}`);
    process.exitCode = 1;
    return;
  }
  heldStagingLock = stagingLock;
  const acceptance = await verifyStagingRelease({
    root: ROOT,
    expected: {
      codeSha: git.sha, versionId: staging.versionId, deploymentId: staging.deploymentId,
      artifactSha: staging.meta?.contentSha,
    },
    force: args.forceVerify,
    skipAuthenticated: args.skipAuthenticated,
    skipVisual: args.skipVisual,
    runCheck: (check) => run("npm", ["run", check], { label: check,
      ...(check === "check:staging-visual" && { env: { SITE_ADMIN_VISUAL_RELEASE: `${git.sha}:${staging.versionId}` } }),
    }),
  });
  console.log(`[release-from-staging] staging ${acceptance.cached ? "cached" : "fresh"} checks: ${acceptance.checks.join(", ")}; version=${acceptance.identity.versionId} publication=${acceptance.identity.publicationSha}`);

  if (productionVersionId) {
    console.log(`[release-from-staging] snapshotting current production version`);
    const note = args.note
      ? `Pre-promotion baseline before ${git.sha.slice(0, 12)}: ${args.note}`
      : `Pre-promotion baseline before ${git.sha.slice(0, 12)}`;
    run(
      "node",
      [
        "scripts/release/snapshot-prod-version.mjs",
        "--auto",
        `--note=${note}`,
      ],
      { label: "snapshot:prod (pre)" },
    );
  }

  console.log(`[release-from-staging] release:prod (build + upload + deploy + verify)`);
  const productionReleaseEnv = {
    CONFIRM_PRODUCTION_DEPLOY: "1",
    CONFIRM_PRODUCTION_SHA: git.sha,
    ...(productionVersionId
      ? { RELEASE_EXPECT_PRODUCTION_VERSION: productionVersionId }
      : {}),
  };
  const dirtyFilesAfterSnapshot = readDirtyFiles();
  if (isOnlyProductionHistoryDirty(dirtyFilesAfterSnapshot)) {
    productionReleaseEnv.ALLOW_DIRTY_PRODUCTION = "1";
    console.log(
      `[release-from-staging] allowing controlled dirty production history file during release: ${PRODUCTION_HISTORY_PATH}`,
    );
  }
  run("npm", ["run", "release:prod", "--", "--skip-checks"], {
    label: "release:prod",
    env: productionReleaseEnv,
  });

  console.log(`[release-from-staging] snapshotting new production version`);
  run(
    "node",
    [
      "scripts/release/snapshot-prod-version.mjs",
      "--auto",
      `--note=${args.note ? `Promoted from staging: ${args.note}` : `Promoted ${git.sha.slice(0, 12)} from staging`}`,
    ],
    { label: "snapshot:prod (post)" },
  );

  console.log(`[release-from-staging] done. main=${git.sha}`);
}

main()
  .catch((error) => {
    console.error(error?.stack || String(error));
    // exitCode instead of exit() so the lock release below still runs.
    process.exitCode = 1;
  })
  .finally(async () => {
    await heldStagingLock?.release();
    await heldReleaseLock?.release();
  });
