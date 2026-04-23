#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { asString, parseArgs } from "./_lib/cli.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

function normalizeEnvName(value) {
  const raw = asString(value).toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  return "staging";
}

function normalizeBaseUrl(value) {
  const raw = asString(value);
  return raw.replace(/\/+$/, "");
}

function resolveBranch(envName) {
  if (envName === "staging") {
    return (
      asString(process.env.SITE_ADMIN_REPO_BRANCH_STAGING || "") ||
      "site-admin-staging"
    );
  }
  return asString(process.env.SITE_ADMIN_REPO_BRANCH_PRODUCTION || "main") || "main";
}

function resolveBaseUrl(envName, argBaseUrl) {
  const explicit = normalizeBaseUrl(argBaseUrl);
  if (explicit) return explicit;
  if (envName === "staging") {
    const stg =
      normalizeBaseUrl(process.env.SITE_ADMIN_BASE_URL_STAGING || "") ||
      normalizeBaseUrl(process.env.SITE_ADMIN_STAGING_BASE_URL || "");
    if (stg) return stg;
    throw new Error("Missing SITE_ADMIN_BASE_URL_STAGING for staging rollback drill");
  }
  const prod =
    normalizeBaseUrl(process.env.SITE_ADMIN_BASE_URL_PRODUCTION || "") ||
    normalizeBaseUrl(process.env.SITE_ADMIN_BASE_URL || "") ||
    "https://jinkunchen.com";
  return prod;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function firstGithubUserFromCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((it) => it.trim().toLowerCase())
    .filter(Boolean)[0] || "";
}

async function buildAutoSiteAdminCookie() {
  const secret = asString(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "");
  const login = firstGithubUserFromCsv(process.env.SITE_ADMIN_GITHUB_USERS || "");
  if (!secret || !login) return "";
  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret,
    token: {
      sub: `rollback-drill-${login}`,
      login,
      name: login,
    },
    maxAge: 60 * 30,
  });
  if (!token) return "";
  return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
}

async function requestJson({ method, url, cookie }) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, {
    method,
    headers,
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

function unwrapApiData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return "data" in raw ? raw.data : raw;
}

async function getStatus(baseUrl, cookie) {
  const response = await requestJson({
    method: "GET",
    url: `${baseUrl}/api/site-admin/status`,
    cookie,
  });
  if (!response.ok || !response.json || response.json.ok !== true) {
    throw new Error(
      `status failed (status=${response.status}, body=${response.text.slice(0, 400)})`,
    );
  }
  return unwrapApiData(response.json);
}

async function triggerDeploy(baseUrl, cookie) {
  const response = await requestJson({
    method: "POST",
    url: `${baseUrl}/api/site-admin/deploy`,
    cookie,
  });
  if (!response.ok || !response.json || response.json.ok !== true) {
    const code = asString(response?.json?.code || "");
    const error = asString(response?.json?.error || "");
    throw new Error(`deploy failed (status=${response.status}, code=${code}, error=${error})`);
  }
  return unwrapApiData(response.json);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitSourceState(baseUrl, cookie, expectedHeadSha, timeoutMs = 180_000) {
  const started = Date.now();
  const expected = asString(expectedHeadSha).toLowerCase();
  for (;;) {
    const status = await getStatus(baseUrl, cookie);
    const currentHead = asString(status?.source?.headSha || "").toLowerCase();
    const pending = status?.source?.pendingDeploy;
    const headMatches = expected && currentHead === expected;
    if (headMatches && (pending === false || pending === null)) {
      return status;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `waitSourceState timeout for head=${expected}, got head=${currentHead}, pending=${String(
          pending,
        )}`,
      );
    }
    await sleep(2_000);
  }
}

async function main() {
  loadProjectEnv({ override: false });
  const args = parseArgs(process.argv.slice(2));
  const envName = normalizeEnvName(args.env || process.env.SITE_ADMIN_ROLLBACK_ENV || "staging");
  const baseUrl = resolveBaseUrl(envName, args.baseUrl || "");
  const branch = resolveBranch(envName);
  const owner = asString(process.env.SITE_ADMIN_REPO_OWNER || "");
  const repo = asString(process.env.SITE_ADMIN_REPO_NAME || "");
  if (!owner || !repo) throw new Error("Missing SITE_ADMIN_REPO_OWNER or SITE_ADMIN_REPO_NAME");

  let cookie = asString(args.cookie || process.env.SITE_ADMIN_COOKIE || "");
  if (!cookie) cookie = await buildAutoSiteAdminCookie();
  if (!cookie) throw new Error("Missing admin cookie and failed to auto-generate");

  const before = await getStatus(baseUrl, cookie);
  if (asString(before?.source?.branch || "") !== branch) {
    throw new Error(
      `status branch mismatch: expected=${branch}, got=${String(before?.source?.branch || "")}`,
    );
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `rollback-drill-${envName}-`));
  const cloneDir = path.join(tempRoot, "repo");
  const remoteUrl = `https://github.com/${owner}/${repo}.git`;

  try {
    run("git", ["clone", "--single-branch", "--branch", branch, remoteUrl, cloneDir]);
    run("git", ["config", "user.name", "site-admin-rollback-drill"], { cwd: cloneDir });
    run("git", ["config", "user.email", "site-admin-rollback-drill@local"], { cwd: cloneDir });

    const headBefore = run("git", ["rev-parse", "HEAD"], { cwd: cloneDir });

    run("git", ["revert", "--no-edit", "HEAD"], { cwd: cloneDir });
    const headAfterRevert = run("git", ["rev-parse", "HEAD"], { cwd: cloneDir });
    run("git", ["push", "origin", `HEAD:${branch}`], { cwd: cloneDir });

    const deploy1 = await triggerDeploy(baseUrl, cookie);
    const statusAfterRevert = await waitSourceState(baseUrl, cookie, headAfterRevert);

    run("git", ["pull", "--ff-only", "origin", branch], { cwd: cloneDir });
    run("git", ["revert", "--no-edit", "HEAD"], { cwd: cloneDir });
    const headAfterRestore = run("git", ["rev-parse", "HEAD"], { cwd: cloneDir });
    run("git", ["push", "origin", `HEAD:${branch}`], { cwd: cloneDir });

    const deploy2 = await triggerDeploy(baseUrl, cookie);
    const statusAfterRestore = await waitSourceState(baseUrl, cookie, headAfterRestore);

    const report = {
      ok: true,
      env: envName,
      baseUrl,
      branch,
      headBefore,
      headAfterRevert,
      headAfterRestore,
      deploy1: {
        provider: deploy1?.provider || null,
        deploymentId: deploy1?.deploymentId || null,
        status: deploy1?.status ?? null,
      },
      deploy2: {
        provider: deploy2?.provider || null,
        deploymentId: deploy2?.deploymentId || null,
        status: deploy2?.status ?? null,
      },
      statusAfterRevert: {
        headSha: statusAfterRevert?.source?.headSha || null,
        pendingDeploy: statusAfterRevert?.source?.pendingDeploy ?? null,
      },
      statusAfterRestore: {
        headSha: statusAfterRestore?.source?.headSha || null,
        pendingDeploy: statusAfterRestore?.source?.pendingDeploy ?? null,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[site-admin-rollback-drill] FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
