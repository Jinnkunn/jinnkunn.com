#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "./load-project-env.mjs";
import {
  buildLiveReleaseStatus,
  DEFAULT_RELEASE_ROUTES,
} from "./_lib/release-live-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function argValue(argv, name) {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function parseArgs(argv = process.argv.slice(2)) {
  const target = argValue(argv, "target") === "staging" ? "staging" : "production";
  const routeArg = argValue(argv, "routes");
  const routes = routeArg
    ? routeArg.split(",").map((item) => item.trim()).filter(Boolean)
    : DEFAULT_RELEASE_ROUTES;
  return {
    compact: argv.includes("--compact"),
    contentChanged: argv.includes("--content-changed"),
    includeRoutes: !argv.includes("--skip-routes"),
    json: argv.includes("--json"),
    routes,
    target,
  };
}

function shortSha(value) {
  return String(value || "").slice(0, 12) || "-";
}

function printHuman(status) {
  const plan = status.plan;
  console.log(`[release-status] target=${status.target} checked=${status.checkedAt}`);
  console.log(`[release-status] local ${status.git.branch} ${shortSha(status.git.sha)} dirty=${status.git.dirty}`);
  console.log(
    `[release-status] staging code=${shortSha(status.deployments.staging.codeSha)} version=${status.deployments.staging.versionId || "-"}`,
  );
  console.log(
    `[release-status] production code=${shortSha(status.deployments.production.codeSha)} version=${status.deployments.production.versionId || "-"}`,
  );
  const stagingOverlay = status.overlays.staging.status;
  const productionOverlay = status.overlays.production.status;
  console.log(
    `[release-status] overlays staging=${shortSha(stagingOverlay?.snapshotSha)} production=${shortSha(productionOverlay?.snapshotSha)}`,
  );
  if (status.routeParity) {
    const skipped = Number(status.routeParity.skippedCount || 0);
    console.log(
      `[release-status] routes ${
        status.routeParity.ok
          ? `matched${skipped ? ` (${skipped} gated skipped)` : ""}`
          : `${status.routeParity.mismatchCount} mismatch(es)`
      }`,
    );
  }
  console.log(`[release-status] next=${plan.label}${plan.script ? ` (${plan.script})` : ""}: ${plan.reason}`);
}

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true });
  const status = await buildLiveReleaseStatus({
    root: ROOT,
    target: args.target,
    routes: args.routes,
    contentChanged: args.contentChanged,
    includeRoutes: args.includeRoutes,
  });
  if (args.json) {
    console.log(JSON.stringify(status, null, args.compact ? 0 : 2));
    return;
  }
  printHuman(status);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
