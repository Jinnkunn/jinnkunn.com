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
//      already proved the same code SHA passes lint/tests/etc.; the
//      production build still runs so it can bundle the latest staging
//      D1 content into the production Worker.
//   8. After success, snapshot the new production version too — gives
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

import { loadProjectEnv } from "./load-project-env.mjs";
import { readActiveDeployment } from "./_lib/cloudflare-api.mjs";
import {
  compareDeploymentToReleaseSource,
  effectiveCodeSha,
} from "./_lib/deploy-metadata.mjs";
import { readMarker } from "./_lib/release-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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
    // --force-verify forces a re-run of verify:staging:authenticated +
    // check:staging-visual even when release-cloudflare.mjs cached a
    // recent successful staging verify for the same SHA. Default is to
    // honor the cache — the operator typically promotes within minutes
    // of a green staging release, and re-running adds 1-3 min for no
    // additional safety.
    forceVerify: argv.includes("--force-verify"),
    note,
  };
}

// Reuse the staging-verify cache that release-cloudflare.mjs writes
// after a successful `verify:cf:staging`. 30 minutes is the
// release-from-staging "warm window" — long enough that
// release:staging → release:prod:from-staging in one sitting hits the
// cache, short enough that an operator coming back from lunch re-runs
// the gates fresh.
const STAGING_VERIFY_TTL_MS = 30 * 60 * 1000;
const STAGING_VERIFY_BUCKET = "staging-verified";
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

function parsePorcelainPath(line) {
  const path = String(line || "").slice(3).trim();
  const renameArrow = " -> ";
  return path.includes(renameArrow) ? path.split(renameArrow).at(-1).trim() : path;
}

function readDirtyFiles() {
  const status = gitValue(["status", "--porcelain"]);
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
  const status = gitValue(["status", "--porcelain"]);
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
  if (git.dirty) {
    reasons.push("working tree is dirty; commit or stash before promoting");
  }
  return { ok: reasons.length === 0, reasons };
}

function fail(message) {
  console.error(`[release-from-staging] ${message}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true });

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
      console.log(`[release-from-staging] (dry-run) ${verdict.code}:\n${verdict.detail}`);
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
              expectProductionVersion: productionVersionId || "(none)",
            },
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

  const verifyCache = args.forceVerify
    ? null
    : readMarker({
        repoRoot: ROOT,
        bucket: STAGING_VERIFY_BUCKET,
        sha: git.sha,
        maxAgeMs: STAGING_VERIFY_TTL_MS,
      });
  if (verifyCache) {
    const ageMin = Math.round((Date.now() - verifyCache._writtenAtMs) / 60000);
    console.log(
      `[release-from-staging] reusing staging verify cache for ${git.sha.slice(0, 12)} (${ageMin}m old). Pass --force-verify to re-run.`,
    );
  }
  if (!args.skipAuthenticated && !verifyCache) {
    console.log(`[release-from-staging] verify:staging:authenticated`);
    run("npm", ["run", "verify:staging:authenticated"], {
      label: "verify:staging:authenticated",
    });
  }
  if (!args.skipVisual && !verifyCache) {
    console.log(`[release-from-staging] check:staging-visual`);
    run("npm", ["run", "check:staging-visual"], {
      label: "check:staging-visual",
    });
  }

  if (productionVersionId) {
    console.log(`[release-from-staging] snapshotting current production version`);
    const note = args.note
      ? `Pre-promotion baseline before ${git.sha.slice(0, 12)}: ${args.note}`
      : `Pre-promotion baseline before ${git.sha.slice(0, 12)}`;
    run(
      "node",
      [
        "scripts/snapshot-prod-version.mjs",
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
      "scripts/snapshot-prod-version.mjs",
      "--auto",
      `--note=${args.note ? `Promoted from staging: ${args.note}` : `Promoted ${git.sha.slice(0, 12)} from staging`}`,
    ],
    { label: "snapshot:prod (post)" },
  );

  console.log(`[release-from-staging] done. main=${git.sha}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
