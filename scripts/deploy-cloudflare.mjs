#!/usr/bin/env node

import { loadProjectEnv } from "./load-project-env.mjs";

function readArgEnvName() {
  const arg = process.argv.find((it) => it.startsWith("--env="));
  const raw = arg ? arg.slice("--env=".length) : "";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "staging" || normalized === "production") return normalized;
  return "production";
}

function readStringEnv(name) {
  return String(process.env[name] || "").trim();
}

function readAccountId() {
  return readStringEnv("CLOUDFLARE_ACCOUNT_ID") || readStringEnv("CF_ACCOUNT_ID");
}

function readApiToken() {
  return readStringEnv("CLOUDFLARE_API_TOKEN") || readStringEnv("CF_API_TOKEN");
}

function pickWorkerName(targetEnv) {
  if (targetEnv === "staging") {
    return (
      readStringEnv("CLOUDFLARE_WORKER_NAME_STAGING") ||
      readStringEnv("CLOUDFLARE_WORKER_NAME")
    );
  }
  return (
    readStringEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION") ||
    readStringEnv("CLOUDFLARE_WORKER_NAME")
  );
}

function pickSourceBranch(targetEnv) {
  const override = readStringEnv("DEPLOY_SOURCE_BRANCH");
  if (override) return override;
  if (targetEnv === "staging") {
    return (
      readStringEnv("SITE_ADMIN_REPO_BRANCH_STAGING") ||
      readStringEnv("SITE_ADMIN_REPO_BRANCH") ||
      "site-admin-staging"
    );
  }
  return (
    readStringEnv("SITE_ADMIN_REPO_BRANCH_PRODUCTION") ||
    readStringEnv("SITE_ADMIN_REPO_BRANCH") ||
    "main"
  );
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pickCloudflareError(body, fallback) {
  const payload = asRecord(body);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  for (const item of errors) {
    const message = asString(asRecord(item).message);
    if (message) return message;
  }
  return fallback;
}

async function fetchGithubBranchHeadSha({ owner, repo, branch }) {
  const o = asString(owner);
  const r = asString(repo);
  const b = asString(branch);
  if (!o || !r || !b) return "";

  const ghToken = readStringEnv("GITHUB_TOKEN") || readStringEnv("GH_TOKEN");
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "site-admin-cloudflare-deploy-script",
    ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
  };
  const url = `https://api.github.com/repos/${encodeURIComponent(o)}/${encodeURIComponent(
    r,
  )}/branches/${encodeURIComponent(b)}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  }).catch(() => null);
  if (!(res instanceof Response) || !res.ok) return "";
  const raw = (await res.json().catch(() => null)) || null;
  const sha = asString(raw?.commit?.sha);
  if (!/^[a-f0-9]{40}$/i.test(sha)) return "";
  return sha.toLowerCase();
}

async function cfRequest({ accountId, apiToken, method, path, body }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.json().catch(() => null);
  const envelope = asRecord(raw);
  if (!res.ok || envelope.success !== true) {
    const msg = pickCloudflareError(raw, `Cloudflare API failed: ${res.status}`);
    throw new Error(msg);
  }
  return envelope.result;
}

function pickSourceShaOverride() {
  const raw = readStringEnv("DEPLOY_SOURCE_SHA").toLowerCase();
  return /^[a-f0-9]{40}$/.test(raw) ? raw : "";
}

function pickLatestVersionId(result) {
  const payload = asRecord(result);
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(result)
      ? result
      : [];
  for (const item of items) {
    const id = asString(asRecord(item).id);
    if (id) return id;
  }
  return "";
}

async function main() {
  loadProjectEnv({ override: true });

  const targetEnv = readArgEnvName();
  const accountId = readAccountId();
  const apiToken = readApiToken();
  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID)");
  if (!apiToken) throw new Error("Missing CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)");
  const workerName = pickWorkerName(targetEnv);
  const sourceBranch = pickSourceBranch(targetEnv);
  const sourceOwner = readStringEnv("SITE_ADMIN_REPO_OWNER");
  const sourceRepo = readStringEnv("SITE_ADMIN_REPO_NAME");
  const sourceSha =
    pickSourceShaOverride() ||
    (await fetchGithubBranchHeadSha({
      owner: sourceOwner,
      repo: sourceRepo,
      branch: sourceBranch,
    }));
  if (!workerName) {
    throw new Error(
      targetEnv === "staging"
        ? "Missing CLOUDFLARE_WORKER_NAME_STAGING or CLOUDFLARE_WORKER_NAME"
        : "Missing CLOUDFLARE_WORKER_NAME_PRODUCTION or CLOUDFLARE_WORKER_NAME",
    );
  }

  const versions = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/versions`,
  });
  const latestVersionId = pickLatestVersionId(versions);
  if (!latestVersionId) {
    throw new Error("No Worker version available to deploy. Upload a version first.");
  }

  const deployPath = `/workers/scripts/${encodeURIComponent(workerName)}/deployments`;
  const dirtySuffix = readStringEnv("DEPLOY_SOURCE_DIRTY") === "1" ? " dirty=1" : "";
  const deployMessage = sourceSha
    ? `Manual deploy (${targetEnv}) source=${sourceSha} branch=${sourceBranch}${dirtySuffix}`
    : `Manual deploy (${targetEnv}) branch=${sourceBranch}`;
  const baseDeployBody = {
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: latestVersionId }],
  };

  let result;
  try {
    result = await cfRequest({
      accountId,
      apiToken,
      method: "POST",
      path: deployPath,
      body: {
        ...baseDeployBody,
        annotations: {
          "workers/message": deployMessage,
        },
      },
    });
  } catch (error) {
    const message = asString(error?.message);
    if (!message.toLowerCase().includes("annotation")) throw error;
    result = await cfRequest({
      accountId,
      apiToken,
      method: "POST",
      path: deployPath,
      body: baseDeployBody,
    });
  }

  const deploymentId = asString(asRecord(result).id);
  console.log(
    JSON.stringify(
      {
        ok: true,
        env: targetEnv,
        worker: workerName,
        sourceBranch,
        sourceSha: sourceSha || null,
        message: deployMessage,
        versionId: latestVersionId,
        deploymentId: deploymentId || null,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
