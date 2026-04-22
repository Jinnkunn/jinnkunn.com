import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_ENV_KEYS = [
  "SITE_ADMIN_STORAGE",
  "SITE_ADMIN_REPO_OWNER",
  "SITE_ADMIN_REPO_NAME",
  "SITE_ADMIN_REPO_BRANCH",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_ID",
  "GITHUB_SECRET",
  "NEXTAUTH_SECRET",
  "SITE_ADMIN_GITHUB_USERS",
  "VERCEL_DEPLOY_HOOK_URL",
  "DEPLOY_TOKEN",
];

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/site-admin-rollout-audit.mjs --project <name> --scope <scope> --branch <branch> --repo-owner <owner> --repo-name <repo> [--json]",
      "",
      "Env fallbacks:",
      "  SITE_ADMIN_ROLLOUT_PROJECT",
      "  SITE_ADMIN_ROLLOUT_SCOPE",
      "  SITE_ADMIN_ROLLOUT_BRANCH",
      "  SITE_ADMIN_ROLLOUT_REPO_OWNER",
      "  SITE_ADMIN_ROLLOUT_REPO_NAME",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const out = {
    json: false,
    project: process.env.SITE_ADMIN_ROLLOUT_PROJECT || "",
    scope: process.env.SITE_ADMIN_ROLLOUT_SCOPE || "",
    branch: process.env.SITE_ADMIN_ROLLOUT_BRANCH || "",
    repoOwner: process.env.SITE_ADMIN_ROLLOUT_REPO_OWNER || "",
    repoName: process.env.SITE_ADMIN_ROLLOUT_REPO_NAME || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (key === "project") out.project = value;
    if (key === "scope") out.scope = value;
    if (key === "branch") out.branch = value;
    if (key === "repo-owner") out.repoOwner = value;
    if (key === "repo-name") out.repoName = value;
    i += 1;
  }

  return out;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const objectIndex = raw.indexOf("{");
  const arrayIndex = raw.indexOf("[");
  let start = -1;
  if (objectIndex >= 0 && arrayIndex >= 0) start = Math.min(objectIndex, arrayIndex);
  else if (objectIndex >= 0) start = objectIndex;
  else if (arrayIndex >= 0) start = arrayIndex;
  if (start < 0) {
    throw new Error(`Expected JSON output, got:\n${raw}`);
  }
  return JSON.parse(raw.slice(start));
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}${stderr}`.trim());
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout,
    stderr,
  };
}

function getProject(project, scope) {
  const result = runCommand("vercel", [
    "api",
    `/v9/projects/${project}`,
    "--scope",
    scope,
    "--raw",
  ]);
  return extractJson(result.stdout);
}

function getProjectEnvs(project, scope) {
  const result = runCommand("vercel", [
    "api",
    `/v10/projects/${project}/env`,
    "--scope",
    scope,
    "--raw",
  ]);
  const parsed = extractJson(result.stdout);
  return Array.isArray(parsed.envs) ? parsed.envs : [];
}

function hasRemoteBranch(branch) {
  const result = runCommand(
    "git",
    ["ls-remote", "--heads", "origin", branch],
    { allowFailure: true },
  );
  return result.ok && Boolean(String(result.stdout || "").trim());
}

function readLocalVercelConfig(rootDir = process.cwd()) {
  const filePath = path.join(rootDir, "vercel.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function envRecordMap(envs) {
  const map = new Map();
  for (const env of envs) {
    const key = String(env?.key || "").trim();
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(env);
    map.set(key, list);
  }
  return map;
}

function envForTarget(map, key, target = "production") {
  const list = map.get(key) || [];
  return list.find((item) => Array.isArray(item?.target) && item.target.includes(target)) || list[0] || null;
}

function addCheck(collection, section, label, status, detail = "") {
  collection.push({ section, label, status, detail });
}

function summarize(checks) {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const item of checks) {
    if (item.status === "ok") ok += 1;
    else if (item.status === "warn") warn += 1;
    else fail += 1;
  }
  return { ok, warn, fail };
}

function printChecks(input) {
  const sections = new Map();
  for (const item of input) {
    const list = sections.get(item.section) || [];
    list.push(item);
    sections.set(item.section, list);
  }
  for (const [section, items] of sections) {
    console.log(`\n${section}`);
    for (const item of items) {
      const prefix = item.status === "ok" ? "OK" : item.status === "warn" ? "WARN" : "FAIL";
      const detail = item.detail ? `: ${item.detail}` : "";
      console.log(`- [${prefix}] ${item.label}${detail}`);
    }
  }
}

function localDeploymentGuard(config, branch) {
  const guard = config?.git?.deploymentEnabled;
  if (!guard || typeof guard !== "object") {
    return { ok: false, detail: "vercel.json is missing git.deploymentEnabled" };
  }
  const mainValue = guard.main;
  const branchValue = guard[branch];
  if (mainValue !== false || branchValue !== false) {
    return {
      ok: false,
      detail: `Expected git.deploymentEnabled.main=false and git.deploymentEnabled.${branch}=false`,
    };
  }
  return { ok: true, detail: `main=false, ${branch}=false` };
}

function valueMatches(env, expected) {
  if (!env) return false;
  const value = String(env?.value || "").trim();
  return value === String(expected || "").trim();
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    usage();
    process.exit(1);
  }

  const required = ["project", "scope", "branch", "repoOwner", "repoName"];
  const missing = required.filter((key) => !String(args[key] || "").trim());
  if (missing.length > 0) {
    console.error(`Missing required inputs: ${missing.join(", ")}`);
    usage();
    process.exit(1);
  }

  const checks = [];
  const project = getProject(args.project, args.scope);
  const envs = getProjectEnvs(args.project, args.scope);
  const envMap = envRecordMap(envs);
  const localVercelConfig = readLocalVercelConfig();
  const deployHooks = Array.isArray(project?.link?.deployHooks) ? project.link.deployHooks : [];
  const stagingHook = deployHooks.find((hook) => String(hook?.ref || "").trim() === args.branch);
  const linkedRepo = `${project?.link?.org || ""}/${project?.link?.repo || ""}`.replace(/^\/|\/$/g, "");
  const expectedRepo = `${args.repoOwner}/${args.repoName}`;

  addCheck(
    checks,
    "Git + Branch",
    "Remote source branch exists",
    hasRemoteBranch(args.branch) ? "ok" : "fail",
    args.branch,
  );

  addCheck(
    checks,
    "Project",
    "Project uses Next.js preset",
    String(project?.framework || "") === "nextjs" ? "ok" : "fail",
    String(project?.framework || "unset"),
  );
  addCheck(
    checks,
    "Project",
    "Project is linked to expected repo",
    linkedRepo === expectedRepo ? "ok" : "fail",
    linkedRepo || "not linked",
  );
  addCheck(
    checks,
    "Project",
    "Project productionBranch is understood",
    String(project?.link?.productionBranch || "") === args.branch ? "ok" : "warn",
    String(project?.link?.productionBranch || "unset") || "unset",
  );
  addCheck(
    checks,
    "Project",
    "Deploy hook exists for source branch",
    stagingHook ? "ok" : "fail",
    stagingHook ? stagingHook.name || args.branch : args.branch,
  );

  const guard = localDeploymentGuard(localVercelConfig, args.branch);
  addCheck(
    checks,
    "Repo Config",
    "Local vercel.json disables auto deploy for source branches",
    guard.ok ? "ok" : "fail",
    guard.detail,
  );

  for (const key of REQUIRED_ENV_KEYS) {
    const env = envForTarget(envMap, key, "production");
    addCheck(
      checks,
      "Project Env",
      `Required env ${key} exists in production target`,
      env ? "ok" : "fail",
      env ? (Array.isArray(env.target) ? env.target.join(",") : "present") : "",
    );
  }

  addCheck(
    checks,
    "Project Env",
    "SITE_ADMIN_STORAGE is github",
    valueMatches(envForTarget(envMap, "SITE_ADMIN_STORAGE"), "github") ? "ok" : "fail",
    String(envForTarget(envMap, "SITE_ADMIN_STORAGE")?.value || "unset"),
  );
  addCheck(
    checks,
    "Project Env",
    "SITE_ADMIN_REPO_OWNER matches expected repo owner",
    valueMatches(envForTarget(envMap, "SITE_ADMIN_REPO_OWNER"), args.repoOwner) ? "ok" : "fail",
    String(envForTarget(envMap, "SITE_ADMIN_REPO_OWNER")?.value || "unset"),
  );
  addCheck(
    checks,
    "Project Env",
    "SITE_ADMIN_REPO_NAME matches expected repo name",
    valueMatches(envForTarget(envMap, "SITE_ADMIN_REPO_NAME"), args.repoName) ? "ok" : "fail",
    String(envForTarget(envMap, "SITE_ADMIN_REPO_NAME")?.value || "unset"),
  );
  addCheck(
    checks,
    "Project Env",
    "SITE_ADMIN_REPO_BRANCH matches expected source branch",
    valueMatches(envForTarget(envMap, "SITE_ADMIN_REPO_BRANCH"), args.branch) ? "ok" : "fail",
    String(envForTarget(envMap, "SITE_ADMIN_REPO_BRANCH")?.value || "unset"),
  );

  const summary = summarize(checks);
  const payload = {
    project: args.project,
    scope: args.scope,
    branch: args.branch,
    repo: expectedRepo,
    checks,
    summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Site Admin Rollout Audit");
    console.log(`Project: ${args.project}`);
    console.log(`Scope: ${args.scope}`);
    console.log(`Expected repo: ${expectedRepo}`);
    console.log(`Expected branch: ${args.branch}`);
    printChecks(checks);
    console.log(`\nSummary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`);
  }

  process.exit(summary.fail > 0 ? 1 : 0);
}

main();
