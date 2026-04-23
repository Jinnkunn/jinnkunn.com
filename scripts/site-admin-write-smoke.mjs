#!/usr/bin/env node

import { asBool, asString, parseArgs } from "./_lib/cli.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

function normalizeEnvName(value) {
  const raw = asString(value).toLowerCase();
  if (raw === "staging") return "staging";
  if (raw === "production" || raw === "prod") return "production";
  return "staging";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapApiData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return "data" in raw ? raw.data : raw;
}

function firstGithubUserFromCsv(raw) {
  const users = String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return users[0] || "";
}

async function buildAutoSiteAdminCookie() {
  const secret = asString(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "");
  const login = firstGithubUserFromCsv(process.env.SITE_ADMIN_GITHUB_USERS || "");
  if (!secret || !login) return "";
  try {
    const { encode } = await import("next-auth/jwt");
    const token = await encode({
      secret,
      token: {
        sub: `write-smoke-${login}`,
        login,
        name: login,
      },
      maxAge: 60 * 30,
    });
    if (!token) return "";
    return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
  } catch {
    return "";
  }
}

async function requestJson({ method, url, cookie, body }) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    ok: res.ok,
    text,
    json,
  };
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function summarizeError(prefix, response) {
  const code =
    response?.json && typeof response.json === "object" && response.json
      ? asString(response.json.code || "")
      : "";
  const message =
    response?.json && typeof response.json === "object" && response.json
      ? asString(response.json.error || "")
      : "";
  return `${prefix} (status=${response?.status || "?"}${code ? `, code=${code}` : ""}${message ? `, error=${message}` : ""})`;
}

async function getStatus(baseUrl, cookie) {
  const response = await requestJson({
    method: "GET",
    url: `${baseUrl}/api/site-admin/status`,
    cookie,
  });
  if (!response.ok || !response.json || response.json.ok !== true) {
    throw new Error(summarizeError("status request failed", response));
  }
  return unwrapApiData(response.json);
}

async function getConfig(baseUrl, cookie) {
  const response = await requestJson({
    method: "GET",
    url: `${baseUrl}/api/site-admin/config`,
    cookie,
  });
  if (!response.ok || !response.json || response.json.ok !== true) {
    throw new Error(summarizeError("config request failed", response));
  }
  return unwrapApiData(response.json);
}

async function saveSeoDescription(baseUrl, cookie, input) {
  const response = await requestJson({
    method: "POST",
    url: `${baseUrl}/api/site-admin/config`,
    cookie,
    body: {
      kind: "settings",
      rowId: input.rowId,
      patch: {
        seoDescription: input.seoDescription,
      },
      expectedSiteConfigSha: input.expectedSiteConfigSha,
    },
  });
  const payload = response.json;
  if (response.ok && payload && payload.ok === true) {
    const data = unwrapApiData(payload);
    const sourceVersion =
      data && typeof data === "object" && data ? data.sourceVersion : null;
    const siteConfigSha =
      sourceVersion && typeof sourceVersion === "object"
        ? asString(sourceVersion.siteConfigSha || "")
        : "";
    assertCondition(Boolean(siteConfigSha), "save succeeded but missing sourceVersion.siteConfigSha");
    return {
      ok: true,
      siteConfigSha,
      raw: data,
    };
  }

  const code =
    payload && typeof payload === "object" && payload ? asString(payload.code || "") : "";
  const error =
    payload && typeof payload === "object" && payload ? asString(payload.error || "") : "";
  return {
    ok: false,
    status: response.status,
    code,
    error,
  };
}

async function triggerDeploy(baseUrl, cookie) {
  const response = await requestJson({
    method: "POST",
    url: `${baseUrl}/api/site-admin/deploy`,
    cookie,
  });
  if (!response.ok || !response.json || response.json.ok !== true) {
    throw new Error(summarizeError("deploy trigger failed", response));
  }
  return unwrapApiData(response.json);
}

async function waitForPendingDeploy(baseUrl, cookie, expected, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const status = await getStatus(baseUrl, cookie);
    const pending = status?.source?.pendingDeploy;
    if (pending === expected) return status;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `pendingDeploy did not reach ${String(expected)} within ${timeoutMs}ms (last=${String(
          pending,
        )})`,
      );
    }
    await sleep(2_000);
  }
}

async function resolveCloudflareWorkersDevBaseUrl(envName) {
  const accountId = asString(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "");
  const apiToken = asString(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "");
  const workerName =
    envName === "staging"
      ? asString(process.env.CLOUDFLARE_WORKER_NAME_STAGING || process.env.CLOUDFLARE_WORKER_NAME || "")
      : asString(process.env.CLOUDFLARE_WORKER_NAME_PRODUCTION || process.env.CLOUDFLARE_WORKER_NAME || "");
  if (!accountId || !apiToken || !workerName) return "";

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  ).catch(() => null);

  if (!(response instanceof Response) || !response.ok) return "";
  const raw = (await response.json().catch(() => null)) || null;
  if (!raw || typeof raw !== "object" || raw.success !== true) return "";
  const subdomain = asString(raw?.result?.subdomain || "");
  if (!subdomain) return "";
  return `https://${workerName}.${subdomain}.workers.dev`;
}

async function resolveBaseUrl(envName, argBaseUrl) {
  const explicit = asString(argBaseUrl);
  if (explicit) return explicit.replace(/\/+$/, "");

  if (envName === "production") {
    const production =
      asString(process.env.SITE_ADMIN_BASE_URL_PRODUCTION || "") ||
      asString(process.env.SITE_ADMIN_BASE_URL || "") ||
      "https://jinkunchen.com";
    return production.replace(/\/+$/, "");
  }

  const stagingExplicit =
    asString(process.env.SITE_ADMIN_BASE_URL_STAGING || "") ||
    asString(process.env.SITE_ADMIN_STAGING_BASE_URL || "");
  if (stagingExplicit) return stagingExplicit.replace(/\/+$/, "");

  const derived = await resolveCloudflareWorkersDevBaseUrl("staging");
  if (derived) return derived.replace(/\/+$/, "");
  throw new Error("missing staging baseUrl (set SITE_ADMIN_BASE_URL_STAGING or pass --baseUrl)");
}

function resolveExpectedBranch(envName, argExpectedBranch) {
  const explicit = asString(argExpectedBranch);
  if (explicit) return explicit;
  if (envName === "production") {
    return asString(process.env.SITE_ADMIN_REPO_BRANCH_PRODUCTION || "main");
  }
  return asString(process.env.SITE_ADMIN_REPO_BRANCH_STAGING || "site-admin-staging");
}

function appendMarker(original, marker) {
  const base = asString(original);
  return base ? `${base} ${marker}` : marker;
}

async function main() {
  loadProjectEnv({ override: false });

  const args = parseArgs(process.argv.slice(2));
  const envName = normalizeEnvName(args.env || process.env.SITE_ADMIN_WRITE_SMOKE_ENV || "staging");
  const runConflict = asBool(args.conflict, envName === "staging");
  const deployTimeoutMs = Number.parseInt(asString(args.deployTimeoutMs || ""), 10) || 180_000;
  const baseUrl = await resolveBaseUrl(envName, args.baseUrl);
  const expectedBranch = resolveExpectedBranch(envName, args.expectedBranch);

  let cookie = asString(args.cookie || process.env.SITE_ADMIN_COOKIE || "");
  if (!cookie) {
    cookie = await buildAutoSiteAdminCookie();
  }
  assertCondition(Boolean(cookie), "missing site-admin cookie and auto-cookie generation failed");

  const statusBefore = await getStatus(baseUrl, cookie);
  assertCondition(
    asString(statusBefore?.source?.storeKind || "") === "github",
    `unexpected source.storeKind=${String(statusBefore?.source?.storeKind || "")}`,
  );
  assertCondition(
    asString(statusBefore?.source?.branch || "") === expectedBranch,
    `unexpected source.branch=${String(statusBefore?.source?.branch || "")}, expected=${expectedBranch}`,
  );

  const configBefore = await getConfig(baseUrl, cookie);
  const settings = configBefore?.settings || null;
  assertCondition(Boolean(settings && settings.rowId), "missing settings rowId in config payload");
  const rowId = asString(settings.rowId || "");
  const originalSeoDescription = asString(settings.seoDescription || "");
  const sourceVersion = configBefore?.sourceVersion || {};
  const initialSiteConfigSha = asString(sourceVersion.siteConfigSha || "");
  assertCondition(Boolean(initialSiteConfigSha), "missing sourceVersion.siteConfigSha");

  const markerBase = `[write-smoke ${envName} ${new Date().toISOString()}]`;
  const nextSeoDescription = appendMarker(originalSeoDescription, markerBase);
  const firstSave = await saveSeoDescription(baseUrl, cookie, {
    rowId,
    seoDescription: nextSeoDescription,
    expectedSiteConfigSha: initialSiteConfigSha,
  });
  if (!firstSave.ok) {
    throw new Error(
      `first save failed (status=${firstSave.status}, code=${firstSave.code}, error=${firstSave.error})`,
    );
  }

  let conflictResult = null;
  if (runConflict) {
    const staleAttempt = await saveSeoDescription(baseUrl, cookie, {
      rowId,
      seoDescription: appendMarker(originalSeoDescription, `${markerBase} [stale]`),
      expectedSiteConfigSha: initialSiteConfigSha,
    });
    conflictResult = staleAttempt;
    assertCondition(!staleAttempt.ok, "expected stale save to fail but it succeeded");
    assertCondition(
      staleAttempt.status === 409 && staleAttempt.code === "SOURCE_CONFLICT",
      `expected SOURCE_CONFLICT 409, got status=${staleAttempt.status}, code=${staleAttempt.code}`,
    );
  }

  const restoreSave = await saveSeoDescription(baseUrl, cookie, {
    rowId,
    seoDescription: originalSeoDescription,
    expectedSiteConfigSha: firstSave.siteConfigSha,
  });
  if (!restoreSave.ok) {
    throw new Error(
      `restore save failed (status=${restoreSave.status}, code=${restoreSave.code}, error=${restoreSave.error})`,
    );
  }

  const warnings = [];
  const statusAfterRestore = await getStatus(baseUrl, cookie);
  const pendingAfterRestore = statusAfterRestore?.source?.pendingDeploy;
  if (pendingAfterRestore === true) {
    // expected path
  } else if (pendingAfterRestore === null) {
    warnings.push(
      "pendingDeploy is null before deploy (runtime cannot currently compare source vs active deployment); falling back to deploy-response validation.",
    );
  } else {
    throw new Error(
      `unexpected pendingDeploy=${String(
        pendingAfterRestore,
      )} after save/restore (expected true or null)`,
    );
  }

  const deployOut = await triggerDeploy(baseUrl, cookie);
  let pendingAfterDeploy = await getStatus(baseUrl, cookie);
  if (pendingAfterRestore === true) {
    pendingAfterDeploy = await waitForPendingDeploy(baseUrl, cookie, false, deployTimeoutMs);
  } else if (pendingAfterDeploy?.source?.pendingDeploy === true) {
    pendingAfterDeploy = await waitForPendingDeploy(baseUrl, cookie, false, deployTimeoutMs);
  }

  const report = {
    ok: true,
    env: envName,
    baseUrl,
    expectedBranch,
    conflict: runConflict,
    sourceBefore: {
      headSha: statusBefore?.source?.headSha || null,
      pendingDeploy: statusBefore?.source?.pendingDeploy ?? null,
    },
    sourceAfterSave: {
      headSha: statusAfterRestore?.source?.headSha || null,
      pendingDeploy: statusAfterRestore?.source?.pendingDeploy ?? null,
    },
    deploy: {
      provider: deployOut?.provider || null,
      deploymentId: deployOut?.deploymentId || null,
      status: deployOut?.status ?? null,
      triggeredAt: deployOut?.triggeredAt || null,
    },
    sourceAfterDeploy: {
      headSha: pendingAfterDeploy?.source?.headSha || null,
      pendingDeploy: pendingAfterDeploy?.source?.pendingDeploy ?? null,
    },
    conflictResult:
      runConflict && conflictResult
        ? {
            status: conflictResult.status,
            code: conflictResult.code,
            error: conflictResult.error,
          }
        : null,
    warnings,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`[site-admin-write-smoke] FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
