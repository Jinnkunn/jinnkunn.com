#!/usr/bin/env node

import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseDeployMessage,
  effectiveCodeSha,
} from "../_lib/deploy-metadata.mjs";

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

function pickSourceBranch() {
  return readStringEnv("DEPLOY_SOURCE_BRANCH") || "main";
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
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : "";
}

function pickCodeShaOverride() {
  const raw = readStringEnv("DEPLOY_CODE_SHA").toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : "";
}

function pickContentShaOverride() {
  const raw = (readStringEnv("DEPLOY_CONTENT_SHA") || readStringEnv("DEPLOY_SOURCE_SHA")).toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : "";
}

function readLocalGitHeadSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const raw = String(result.stdout || "").trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(raw) ? raw : "";
}

export function describeVersionMismatch({ actual, expectedCodeSha, expectedContentSha }) {
  const got = effectiveCodeSha(actual);
  if (!got) return `metadata missing code/source SHA; expected ${expectedCodeSha}`;
  if (expectedCodeSha && got !== expectedCodeSha) {
    return `code=${got} expected ${expectedCodeSha}`;
  }
  const gotContent = asString(actual.contentSha || actual.sourceSha).toLowerCase();
  if (expectedContentSha && !gotContent) {
    return `content metadata missing; expected ${expectedContentSha}`;
  }
  if (expectedContentSha && gotContent !== expectedContentSha) {
    return `content=${gotContent} expected ${expectedContentSha}`;
  }
  return "";
}

/**
 * Decide whether the latest uploaded version may be deployed. Applies to BOTH
 * environments: a standalone `deploy:cf:prod` used to promote whatever version
 * was uploaded last — potentially an old or unintended upload — with no SHA
 * comparison at all. ALLOW_STALE_PROD_DEPLOY=1 is the explicit emergency
 * escape hatch for re-deploying the last upload on purpose.
 */
export function evaluateStaleVersionGuard({ targetEnv, mismatch, allowStaleProdOverride = false }) {
  if (!mismatch) return { deploy: true };
  if (targetEnv === "production" && allowStaleProdOverride) {
    return { deploy: true, warned: true };
  }
  const hint =
    targetEnv === "staging"
      ? "Run npm run release:staging to rebuild and re-upload at HEAD."
      : "Run npm run release:prod (or release:prod:from-staging) to upload a matching version first, or set ALLOW_STALE_PROD_DEPLOY=1 only for an intentional emergency re-deploy of the last upload.";
  return { deploy: false, hint };
}

function pickLatestVersion(result) {
  const payload = asRecord(result);
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(result)
      ? result
      : [];
  for (const item of items) {
    const record = asRecord(item);
    const id = asString(record.id);
    if (!id) continue;
    const annotations = asRecord(record.annotations);
    return {
      id,
      message:
        asString(annotations["workers/message"]) ||
        asString(record.message) ||
        asString(record.tag),
    };
  }
  return null;
}

async function main() {
  loadProjectEnv({ override: true });

  const targetEnv = readArgEnvName();
  const accountId = readAccountId();
  const apiToken = readApiToken();
  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID)");
  if (!apiToken) throw new Error("Missing CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)");
  const workerName = pickWorkerName(targetEnv);
  const sourceBranch = pickSourceBranch();
  const codeSha = pickCodeShaOverride() || readLocalGitHeadSha();
  // db mode keeps code and content as separate metadata: code is the git
  // SHA; content is the post-D1-dump snapshot hash. Direct invocations
  // fall through to the local git HEAD for both.
  const contentShaOverride = pickContentShaOverride() || pickSourceShaOverride();
  const contentSha = contentShaOverride || codeSha;
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
  const latestVersion = pickLatestVersion(versions);
  if (!latestVersion) {
    throw new Error("No Worker version available to deploy. Upload a version first.");
  }
  if (codeSha) {
    const mismatch = describeVersionMismatch({
      actual: parseDeployMessage(latestVersion.message),
      expectedCodeSha: codeSha,
      // Only compare content when the caller actually supplied a content
      // snapshot SHA (release-cloudflare always does). The git-HEAD fallback
      // can never equal a db-mode content hash, so comparing it would trip
      // the guard on every manual deploy for pure content noise.
      expectedContentSha: contentShaOverride,
    });
    const guard = evaluateStaleVersionGuard({
      targetEnv,
      mismatch,
      allowStaleProdOverride: readStringEnv("ALLOW_STALE_PROD_DEPLOY") === "1",
    });
    if (guard.warned) {
      console.warn(
        `[deploy-cloudflare] WARNING: deploying stale production version ${latestVersion.id} (${mismatch}) because ALLOW_STALE_PROD_DEPLOY=1`,
      );
    }
    if (!guard.deploy) {
      throw new Error(
        `DEPLOY_VERSION_STALE: latest uploaded Worker version ${latestVersion.id} does not match the deploying source (${mismatch}). ${guard.hint}`,
      );
    }
  }

  const deployPath = `/workers/scripts/${encodeURIComponent(workerName)}/deployments`;
  const dirtySuffix = readStringEnv("DEPLOY_SOURCE_DIRTY") === "1" ? " dirty=1" : "";
  const deployMessage = contentSha
    ? `Manual deploy (${targetEnv}) source=${contentSha} branch=${sourceBranch} content=${contentSha} contentBranch=${sourceBranch}${codeSha ? ` code=${codeSha}` : ""}${dirtySuffix}`
    : `Manual deploy (${targetEnv}) branch=${sourceBranch}`;
  const baseDeployBody = {
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: latestVersion.id }],
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
        sourceSha: contentSha || null,
        contentSha: contentSha || null,
        codeSha: codeSha || null,
        message: deployMessage,
        versionId: latestVersion.id,
        deploymentId: deploymentId || null,
      },
      null,
      2,
    ),
  );
}

// Only self-run when invoked as a script so tests can import the guard helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  });
}
