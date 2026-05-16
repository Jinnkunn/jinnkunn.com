#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { buildLiveReleaseStatus } from "../_lib/release-live-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    contentChanged: argv.includes("--content-changed"),
    skipRoutes: argv.includes("--skip-routes"),
    target:
      argv.includes("--production-content") || argv.find((arg) => arg === "--target=production")
        ? "production"
        : argv.find((arg) => arg === "--target=staging")
          ? "staging"
          : "production",
  };
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
    throw new Error(`${options.label || [command, ...args].join(" ")} failed${output ? `\n${output}` : ""}`);
  }
  return output;
}

function runNpmScript(script, dryRun) {
  if (dryRun) {
    console.log(`[release-site] would run: npm run ${script}`);
    return;
  }
  run("npm", ["run", script], { label: `npm run ${script}` });
}

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true, files: [".env"] });

  const status = await buildLiveReleaseStatus({
    root: ROOT,
    target: args.target,
    contentChanged: args.contentChanged,
    includeRoutes: !args.skipRoutes,
  });
  const plan = status.plan;

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: args.dryRun,
        action: plan.kind,
        script: plan.script,
        reason: plan.reason,
        source: status.git,
        status,
      },
      null,
      2,
    ),
  );

  if (plan.kind === "blocked") {
    throw new Error(plan.reason);
  }
  if (!plan.script) {
    console.log("[release-site] no release command needed");
    return;
  }
  runNpmScript(plan.script, args.dryRun);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
