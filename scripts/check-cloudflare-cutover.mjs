#!/usr/bin/env node

import { loadProjectEnv } from "./load-project-env.mjs";

function isSet(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function hasAny(names) {
  return names.some((name) => isSet(name));
}

function printSection(title) {
  console.log(`\n[${title}]`);
}

function printStatus(name, ok) {
  console.log(`${ok ? "OK" : "MISSING"}  ${name}`);
}

function main() {
  loadProjectEnv({ override: true });

  let fail = false;

  printSection("Shared (Cloudflare + Site Admin)");
  const shared = [
    "SITE_ADMIN_STORAGE",
    "SITE_ADMIN_REPO_OWNER",
    "SITE_ADMIN_REPO_NAME",
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "DEPLOY_TOKEN",
  ];
  for (const key of shared) {
    const ok = isSet(key);
    printStatus(key, ok);
    if (!ok) fail = true;
  }
  const hasGithubPrivateKey = hasAny([
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_PRIVATE_KEY_FILE",
  ]);
  printStatus("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE", hasGithubPrivateKey);
  if (!hasGithubPrivateKey) fail = true;

  printSection("Deploy Target");
  const deployProvider = process.env.DEPLOY_PROVIDER || "(auto)";
  console.log(`INFO  DEPLOY_PROVIDER=${deployProvider}`);

  const hasHookTarget = hasAny(["DEPLOY_HOOK_URL"]);
  const hasCloudflareApiTarget =
    hasAny(["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"]) &&
    hasAny(["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"]) &&
    isSet("CLOUDFLARE_WORKER_NAME");

  printStatus("DEPLOY_HOOK_URL", hasHookTarget);
  printStatus("Cloudflare API deploy triple", hasCloudflareApiTarget);
  if (!hasHookTarget && !hasCloudflareApiTarget) fail = true;

  printSection("Branch Binding");
  const stagingBranch = String(process.env.SITE_ADMIN_REPO_BRANCH_STAGING || "site-admin-staging");
  const productionBranch = String(process.env.SITE_ADMIN_REPO_BRANCH_PRODUCTION || "main");
  console.log(`INFO  staging source branch expected: ${stagingBranch}`);
  console.log(`INFO  production source branch expected: ${productionBranch}`);
  printStatus("SITE_ADMIN_REPO_BRANCH", isSet("SITE_ADMIN_REPO_BRANCH"));
  if (!isSet("SITE_ADMIN_REPO_BRANCH")) fail = true;

  printSection("Worker Name Split (recommended)");
  const hasStagingWorker = isSet("CLOUDFLARE_WORKER_NAME_STAGING");
  const hasProdWorker = isSet("CLOUDFLARE_WORKER_NAME_PRODUCTION");
  const hasFallbackWorker = isSet("CLOUDFLARE_WORKER_NAME");
  printStatus("CLOUDFLARE_WORKER_NAME_STAGING", hasStagingWorker);
  printStatus("CLOUDFLARE_WORKER_NAME_PRODUCTION", hasProdWorker);
  printStatus("CLOUDFLARE_WORKER_NAME", hasFallbackWorker);
  if ((!hasStagingWorker || !hasProdWorker) && !hasFallbackWorker) {
    fail = true;
  }

  console.log(`\n${fail ? "FAILED" : "PASSED"}  Cloudflare cutover preflight`);
  process.exitCode = fail ? 1 : 0;
}

main();
