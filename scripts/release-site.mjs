#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "./load-project-env.mjs";
import { readActiveDeployment } from "./_lib/cloudflare-api.mjs";
import { effectiveCodeSha } from "./_lib/deploy-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WRANGLER_TOML = path.join(ROOT, "wrangler.toml");

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    productionContent: argv.includes("--production-content"),
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

function gitValue(args) {
  return run("git", args, { capture: true, label: `git ${args.join(" ")}` }).trim();
}

function readGitState() {
  const sha = gitValue(["rev-parse", "HEAD"]);
  const branch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = gitValue(["status", "--porcelain"]);
  const dirtyFiles = status.split(/\r?\n/).filter(Boolean);
  return {
    sha,
    branch: branch === "HEAD" ? "detached" : branch,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
  };
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function workerNameForEnv(env) {
  const explicit = env === "staging"
    ? readEnv("CLOUDFLARE_WORKER_NAME_STAGING")
    : readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION");
  if (explicit) return explicit;
  const raw = fs.readFileSync(WRANGLER_TOML, "utf8");
  const marker = `[env.${env}]`;
  const start = raw.indexOf(marker);
  if (start < 0) return env === "staging" ? "jinnkunn-site-staging" : "jinnkunn-site";
  const rest = raw.slice(start + marker.length);
  const nextBlock = rest.search(/\n\[/);
  const block = nextBlock >= 0 ? rest.slice(0, nextBlock) : rest;
  const match = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
  return match?.[1] || (env === "staging" ? "jinnkunn-site-staging" : "jinnkunn-site");
}

function contentOnlyDiffFrom(baseSha, headSha) {
  if (!baseSha || !headSha || baseSha === headSha) return { ok: true, files: [] };
  let output = "";
  try {
    output = run("git", ["diff", "--name-only", `${baseSha}..${headSha}`], {
      capture: true,
      label: `git diff --name-only ${baseSha}..${headSha}`,
    });
  } catch (error) {
    return { ok: false, files: [], error: error?.message || String(error) };
  }
  const files = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    ok: files.every((file) => file.startsWith("content/")),
    files,
  };
}

async function activeWorkerCodeSha(env) {
  const active = await readActiveDeployment({
    accountId: readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID"),
    apiToken: readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN"),
    workerName: workerNameForEnv(env),
  });
  return effectiveCodeSha(active?.meta);
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

  const git = readGitState();
  if (git.branch !== "main") {
    throw new Error(`Smart release must run from main, not ${git.branch}.`);
  }
  if (git.dirty) {
    throw new Error(
      [
        "Smart release needs a clean working tree.",
        ...git.dirtyFiles.slice(0, 12).map((file) => `  - ${file}`),
      ].join("\n"),
    );
  }

  const stagingCodeSha = await activeWorkerCodeSha("staging");
  const stagingDiff = contentOnlyDiffFrom(stagingCodeSha, git.sha);
  const action = !stagingCodeSha || !stagingDiff.ok
    ? "deploy-staging-code"
    : args.productionContent
      ? "publish-content-production-from-staging"
      : "publish-content-staging";

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: args.dryRun,
        action,
        source: {
          sha: git.sha,
          branch: git.branch,
        },
        stagingCodeSha,
        reason:
          action === "deploy-staging-code"
            ? "Staging code is behind local HEAD; deploy staging first."
            : action === "publish-content-production-from-staging"
              ? "Copy the already-verified staging content overlay to production."
              : "Staging code is compatible; publish content overlay.",
      },
      null,
      2,
    ),
  );

  if (action === "deploy-staging-code") {
    runNpmScript("release:staging", args.dryRun);
  } else if (action === "publish-content-production-from-staging") {
    runNpmScript("publish:content:prod:from-staging", args.dryRun);
  } else {
    runNpmScript("publish:content:staging", args.dryRun);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
