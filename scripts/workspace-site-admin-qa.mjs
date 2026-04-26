#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asBool, parseArgs } from "./_lib/cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORKSPACE = path.join(ROOT, "apps", "workspace");

const DEFAULT_EXPECTED_PRODUCTION_VERSION = "34ae93d5-e251-4277-9e49-42f535558677";

function runStep({ name, command, args, cwd = ROOT, env = {} }) {
  const startedAt = Date.now();
  console.log(`[workspace-site-admin-qa] ${name}: start`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(`${name} failed after ${durationMs}ms`);
  }
  console.log(`[workspace-site-admin-qa] ${name}: ok ${durationMs}ms`);
  return { name, durationMs };
}

function parseCli() {
  const args = parseArgs(process.argv.slice(2));
  const localOnly = asBool(args["local-only"], false);
  const skipRemote = localOnly || asBool(args["skip-remote"], false);
  const skipWorkspaceBuild = asBool(args["skip-workspace-build"], false);
  const skipWorkspaceTests = asBool(args["skip-workspace-tests"], false);
  const skipWorkspaceUi = asBool(args["skip-workspace-ui"], false);
  const skipStaging = skipRemote || asBool(args["skip-staging"], false);
  const skipAssets = skipRemote || asBool(args["skip-assets"], false);
  const skipProductionGuard = skipRemote || asBool(args["skip-production-guard"], false);
  const expectedProductionVersion =
    args["expected-production-version"] ||
    process.env.VERIFY_CF_EXPECT_PRODUCTION_VERSION ||
    DEFAULT_EXPECTED_PRODUCTION_VERSION;
  return {
    skipWorkspaceBuild,
    skipWorkspaceTests,
    skipWorkspaceUi,
    skipStaging,
    skipAssets,
    skipProductionGuard,
    expectedProductionVersion,
  };
}

async function main() {
  const args = parseCli();
  const steps = [];

  if (!args.skipWorkspaceBuild) {
    steps.push(
      runStep({
        name: "workspace build",
        command: "npm",
        args: ["run", "build"],
        cwd: WORKSPACE,
      }),
    );
  }

  if (!args.skipWorkspaceTests) {
    steps.push(
      runStep({
        name: "workspace tests",
        command: "npm",
        args: ["run", "test"],
        cwd: WORKSPACE,
      }),
    );
  }

  if (!args.skipWorkspaceUi) {
    steps.push(
      runStep({
        name: "workspace UI guardrails",
        command: "npm",
        args: ["run", "check:workspace-ui"],
      }),
    );
  }

  if (!args.skipStaging) {
    steps.push(
      runStep({
        name: "staging authenticated QA",
        command: "npm",
        args: ["run", "verify:staging:authenticated"],
      }),
    );
  }

  if (!args.skipAssets) {
    steps.push(
      runStep({
        name: "staging asset upload smoke",
        command: "npm",
        args: ["run", "smoke:site-admin:assets:staging"],
      }),
    );
  }

  if (!args.skipProductionGuard) {
    steps.push(
      runStep({
        name: "production guard",
        command: "npm",
        args: ["run", "verify:cf:prod"],
        env: {
          VERIFY_CF_EXPECT_PRODUCTION_VERSION: args.expectedProductionVersion,
        },
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        steps,
        skipped: {
          workspaceBuild: args.skipWorkspaceBuild,
          workspaceTests: args.skipWorkspaceTests,
          workspaceUi: args.skipWorkspaceUi,
          staging: args.skipStaging,
          assets: args.skipAssets,
          productionGuard: args.skipProductionGuard,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[workspace-site-admin-qa] FAIL: ${error?.stack || String(error)}`);
  process.exitCode = 1;
});
