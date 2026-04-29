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
//      its `code=` SHA matches the local main HEAD. If staging is
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
//      build is still re-run because production uses content from
//      main rather than the staging content overlay.
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
    note,
  };
}

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

async function cfRequest({ accountId, apiToken, method, path: apiPath }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Cloudflare API ${method} ${apiPath} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok || !payload || payload.success === false) {
    const errors =
      payload?.errors?.map((e) => e.message).join("; ") ||
      text ||
      response.statusText;
    throw new Error(
      `Cloudflare API ${method} ${apiPath} failed (${response.status}): ${errors}`,
    );
  }
  return payload.result ?? payload;
}

function parseDeployMessage(messageRaw) {
  const message = String(messageRaw || "");
  const token = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}=([^\\s]+)`, "i").exec(message);
    return hit?.[1] || "";
  };
  return {
    sourceSha: token("source"),
    sourceBranch: token("branch"),
    codeSha: token("code"),
    codeBranch: token("codeBranch"),
    contentSha: token("content"),
    contentBranch: token("contentBranch"),
  };
}

// Cloudflare list endpoints wrap arrays under type-specific keys
// (`{ deployments: [...] }`, `{ items: [...] }`). Walk all array values
// so this stays resilient to which key the API picks.
function pickFirst(payload) {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (!payload || typeof payload !== "object") return null;
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return null;
}

async function readActiveDeployment({ accountId, apiToken, workerName }) {
  const deployments = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  });
  const active = pickFirst(deployments);
  if (!active) return null;
  const versions = Array.isArray(active.versions) ? active.versions : [];
  versions.sort(
    (a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0),
  );
  const primary = versions[0];
  if (!primary?.version_id) return null;
  const versionDetail = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(primary.version_id)}`,
  });
  const annotations = (versionDetail && versionDetail.annotations) || {};
  const message = annotations["workers/message"] || versionDetail?.message || "";
  return {
    deploymentId: String(active.id || ""),
    versionId: primary.version_id,
    versionMessage: message,
    meta: parseDeployMessage(message),
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
  const stagingCodeSha = staging.meta.codeSha || staging.meta.sourceSha;
  if (!stagingCodeSha) {
    fail(
      `Cannot read code SHA from staging deployment annotation: ${JSON.stringify(staging.meta)}`,
    );
  }
  if (stagingCodeSha.toLowerCase() !== git.sha.toLowerCase()) {
    const message = [
      `Staging is on a different code SHA:`,
      `  staging: ${stagingCodeSha}`,
      `  main:    ${git.sha}`,
      ``,
      `Run \`npm run release:staging\` first so staging matches main, then retry.`,
    ].join("\n");
    if (args.dryRun) {
      console.log(`[release-from-staging] (dry-run) staging mismatch:\n${message}`);
    } else {
      fail(message);
    }
  }
  console.log(
    `[release-from-staging] staging matches main: code=${stagingCodeSha} versionId=${staging.versionId}`,
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

  if (!args.skipAuthenticated) {
    console.log(`[release-from-staging] verify:staging:authenticated`);
    run("npm", ["run", "verify:staging:authenticated"], {
      label: "verify:staging:authenticated",
    });
  }
  if (!args.skipVisual) {
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
  run("npm", ["run", "release:prod", "--", "--skip-checks"], {
    label: "release:prod",
    env: {
      CONFIRM_PRODUCTION_DEPLOY: "1",
      CONFIRM_PRODUCTION_SHA: git.sha,
      ...(productionVersionId
        ? { RELEASE_EXPECT_PRODUCTION_VERSION: productionVersionId }
        : {}),
    },
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
