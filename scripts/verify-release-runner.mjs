#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { loadProjectEnv } from "./load-project-env.mjs";

const DEFAULT_SITE_ADMIN_ORIGIN = "https://staging.jinkunchen.com";
const DEFAULT_RUNNER_URL = "https://release-runner.jinkunchen.com";
const REQUIRED_SECRETS = [
  "RELEASE_RUNNER_CF_ACCESS_CLIENT_ID",
  "RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET",
  "RELEASE_RUNNER_WAKE_TOKEN",
  "RELEASE_RUNNER_WAKE_URL",
  "SITE_ADMIN_RELEASE_AGENT_TOKEN",
];

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

function normalizeOrigin(value, fallback) {
  return String(value || fallback || "").trim().replace(/\/+$/, "");
}

function firstAllowedGithubUser() {
  for (const part of String(process.env.SITE_ADMIN_GITHUB_USERS || "").split(/[,\n]/)) {
    const login = String(part || "").trim().replace(/^@+/, "").toLowerCase();
    if (login) return login;
  }
  return "";
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function createSiteAdminToken() {
  const secret = String(
    process.env.SITE_ADMIN_APP_TOKEN_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "",
  ).trim();
  const login = firstAllowedGithubUser();
  assert(secret, "SITE_ADMIN_APP_TOKEN_SECRET/NEXTAUTH_SECRET is required");
  assert(login, "SITE_ADMIN_GITHUB_USERS must include at least one login");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: "site-admin-app",
      exp: now + 10 * 60,
      iat: now,
      iss: "site-admin",
      sub: login,
    }),
  );
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { body, response, text };
}

function payloadData(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

async function checkAccessProtection(runnerUrl) {
  const response = await fetch(`${runnerUrl}/health`, {
    cache: "no-store",
    redirect: "manual",
  });
  assert(
    response.status === 401 || response.status === 403 || response.status === 302,
    "runner public health is not protected by Cloudflare Access",
    { status: response.status, url: `${runnerUrl}/health` },
  );
  console.log(`[verify-release-runner] public runner health protected: HTTP ${response.status}`);
}

function listWranglerSecrets(env) {
  const result = spawnSync("npx", ["wrangler", "secret", "list", "--env", env, "--format", "json"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(result.status === 0, `wrangler secret list failed for ${env}`, {
    stderr: result.stderr.trim(),
    stdout: result.stdout.trim(),
  });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`wrangler secret list returned invalid JSON for ${env}: ${error.message}`);
  }
}

function checkWorkerSecrets(env) {
  const names = new Set(listWranglerSecrets(env).map((item) => String(item.name || "")));
  const missing = REQUIRED_SECRETS.filter((name) => !names.has(name));
  assert(missing.length === 0, `${env} is missing release runner secrets`, { missing });
  console.log(`[verify-release-runner] ${env} release runner secrets present`);
}

async function createStatusJob(origin, token) {
  const { body, response, text } = await fetchJson(`${origin}/api/site-admin/release-jobs`, {
    body: JSON.stringify({
      action: "status",
      request: { source: "verify-release-runner" },
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  assert(response.status === 202, "failed to create remote status job", {
    body: body || text.slice(0, 500),
    status: response.status,
  });
  const data = payloadData(body);
  const job = data.job && typeof data.job === "object" ? data.job : null;
  const wake = data.wake && typeof data.wake === "object" ? data.wake : null;
  assert(job?.id, "remote status job response did not include a job id", { body });
  assert(wake?.configured === true && wake?.ok === true, "Mac mini wake was not accepted", { wake });
  console.log(`[verify-release-runner] queued status job ${job.id} with wake.ok=true`);
  return String(job.id);
}

async function getJob(origin, token, jobId) {
  const { body, response, text } = await fetchJson(`${origin}/api/site-admin/release-jobs/${jobId}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(response.status === 200, "failed to read remote release job", {
    body: body || text.slice(0, 500),
    jobId,
    status: response.status,
  });
  return payloadData(body);
}

async function waitForStatusJob(origin, token, jobId) {
  let latest = null;
  for (let i = 0; i < 45; i += 1) {
    latest = await getJob(origin, token, jobId);
    const job = latest.job && typeof latest.job === "object" ? latest.job : {};
    const status = String(job.status || "");
    if (status === "succeeded") {
      console.log(`[verify-release-runner] status job succeeded`);
      return;
    }
    if (status === "failed" || status === "canceled") {
      throw new Error(`status job ended as ${status}: ${String(job.error || "")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const job = latest?.job || {};
  throw new Error(`status job did not finish in time: ${String(job.status || "unknown")}`);
}

async function main() {
  loadProjectEnv({ files: [".env"], override: true });
  const origin = normalizeOrigin(
    argValue("origin"),
    DEFAULT_SITE_ADMIN_ORIGIN,
  );
  const runnerUrl = normalizeOrigin(
    argValue("runner-url") || process.env.RELEASE_RUNNER_WAKE_URL,
    DEFAULT_RUNNER_URL,
  );
  const envs = hasFlag("staging-only") ? ["staging"] : ["staging", "production"];

  await checkAccessProtection(runnerUrl);
  for (const env of envs) checkWorkerSecrets(env);

  if (hasFlag("skip-job")) return;
  const token = createSiteAdminToken();
  const jobId = await createStatusJob(origin, token);
  await waitForStatusJob(origin, token, jobId);
}

main().catch((error) => {
  console.error(`[verify-release-runner] ${error?.stack || String(error)}`);
  process.exit(1);
});
