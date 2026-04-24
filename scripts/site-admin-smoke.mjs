#!/usr/bin/env node

import { parseArgs } from "./_lib/cli.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

function fail(message) {
  console.error(`[site-admin-smoke] FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[site-admin-smoke] OK: ${message}`);
}

async function fetchJson(url, cookie) {
  const res = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const raw = await res.json().catch(() => null);
  return { res, raw };
}

function firstGithubUserFromCsv(raw) {
  const users = String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return users[0] || "";
}

async function buildAutoSiteAdminCookie() {
  const secret = String(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  if (!secret) return "";

  const login = firstGithubUserFromCsv(process.env.SITE_ADMIN_GITHUB_USERS || "");
  if (!login) return "";

  try {
    const { encode } = await import("next-auth/jwt");
    const token = await encode({
      secret,
      token: {
        sub: `smoke-${login}`,
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

async function main() {
  loadProjectEnv({ override: false });

  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args.baseUrl || process.env.SITE_ADMIN_BASE_URL || "").trim();
  let cookie = String(args.cookie || process.env.SITE_ADMIN_COOKIE || "").trim();
  const expectedStoreKind = String(
    args.expectedStoreKind || process.env.SITE_ADMIN_EXPECTED_STORE_KIND || "",
  )
    .trim()
    .toLowerCase();
  const expectedBranch = String(
    args.expectedBranch || process.env.SITE_ADMIN_EXPECTED_BRANCH || "",
  ).trim();
  const expectedPendingDeployRaw = String(
    args.expectedPendingDeploy || process.env.SITE_ADMIN_EXPECTED_PENDING_DEPLOY || "",
  )
    .trim()
    .toLowerCase();

  if (!baseUrl) {
    fail("missing --baseUrl (or SITE_ADMIN_BASE_URL)");
    return;
  }

  if (!cookie) {
    cookie = await buildAutoSiteAdminCookie();
    if (!cookie) {
      fail(
        "missing --cookie (or SITE_ADMIN_COOKIE), and auto-cookie is unavailable (check NEXTAUTH_SECRET + SITE_ADMIN_GITHUB_USERS).",
      );
      return;
    }
    ok("auto-generated site-admin cookie from NEXTAUTH_SECRET + SITE_ADMIN_GITHUB_USERS");
  }

  const statusUrl = `${baseUrl.replace(/\/+$/, "")}/api/site-admin/status`;
  const configUrl = `${baseUrl.replace(/\/+$/, "")}/api/site-admin/config`;
  const routesUrl = `${baseUrl.replace(/\/+$/, "")}/api/site-admin/routes`;

  const status = await fetchJson(statusUrl, cookie);
  if (!status.res.ok || !status.raw || status.raw.ok !== true) {
    fail(`status request failed (${status.res.status})`);
    return;
  }
  ok(`status reachable (${status.res.status})`);

  const source = status.raw?.data?.source || status.raw?.source || null;
  if (!source || typeof source !== "object") {
    fail("status payload missing source object");
    return;
  }
  ok("status includes source object");

  if (expectedStoreKind && String(source.storeKind || "").toLowerCase() !== expectedStoreKind) {
    fail(`source.storeKind mismatch, expected=${expectedStoreKind}, got=${source.storeKind}`);
    return;
  }
  if (expectedStoreKind) ok(`source.storeKind=${source.storeKind}`);

  if (expectedBranch && String(source.branch || "") !== expectedBranch) {
    fail(`source.branch mismatch, expected=${expectedBranch}, got=${source.branch}`);
    return;
  }
  if (expectedBranch) ok(`source.branch=${source.branch}`);

  if (expectedPendingDeployRaw) {
    const expectedPendingDeploy =
      expectedPendingDeployRaw === "true" || expectedPendingDeployRaw === "1";
    if (source.pendingDeploy !== expectedPendingDeploy) {
      fail(
        `source.pendingDeploy mismatch, expected=${expectedPendingDeploy}, got=${source.pendingDeploy}`,
      );
      return;
    }
    ok(`source.pendingDeploy=${String(source.pendingDeploy)}`);
  }

  const config = await fetchJson(configUrl, cookie);
  if (!config.res.ok || !config.raw || config.raw.ok !== true) {
    fail(`config request failed (${config.res.status})`);
    return;
  }
  const configData = config.raw?.data || config.raw;
  if (!configData?.sourceVersion?.siteConfigSha) {
    fail("config payload missing sourceVersion.siteConfigSha");
    return;
  }
  ok("config includes sourceVersion");

  const routes = await fetchJson(routesUrl, cookie);
  if (!routes.res.ok || !routes.raw || routes.raw.ok !== true) {
    fail(`routes request failed (${routes.res.status})`);
    return;
  }
  const routesData = routes.raw?.data || routes.raw;
  if (!routesData?.sourceVersion?.siteConfigSha || !routesData?.sourceVersion?.protectedRoutesSha) {
    fail("routes payload missing sourceVersion fields");
    return;
  }
  ok("routes includes sourceVersion");

  ok("basic smoke checks passed");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
