#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";

const ENVIRONMENTS = new Set(["staging", "production", "both"]);

function parseArgs(argv = process.argv.slice(2)) {
  const envArg =
    argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ||
    process.env.VERIFY_CF_ENV ||
    "staging";
  const env = ENVIRONMENTS.has(envArg) ? envArg : "staging";
  return {
    env,
    expectedProductionVersion:
      argv
        .find((arg) => arg.startsWith("--expected-production-version="))
        ?.slice("--expected-production-version=".length) ||
      process.env.VERIFY_CF_EXPECT_PRODUCTION_VERSION ||
      "",
  };
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

async function checkHttp({ name, url, expectedStatus, locationIncludes }) {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const location = response.headers.get("location") || "";
  assert(response.status === expectedStatus, `${name} returned wrong status`, {
    url,
    status: response.status,
    expectedStatus,
    location,
  });
  if (locationIncludes) {
    assert(location.includes(locationIncludes), `${name} redirect target drifted`, {
      url,
      location,
      locationIncludes,
    });
  }
  console.log(`[verify-cloudflare] ${name}: ${response.status}`);
}

function isSiteLoginRedirect(location) {
  return (
    location.includes("/api/auth/signin") ||
    location.includes("/site-admin/login")
  );
}

async function checkStagingLoginRedirect({ name, url }) {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const location = response.headers.get("location") || "";
  assert(response.status === 302, `${name} returned wrong status`, {
    url,
    status: response.status,
    expectedStatus: 302,
    location,
  });
  assert(isSiteLoginRedirect(location), `${name} redirect target drifted`, {
    url,
    location,
    expectedLocationIncludes: ["/api/auth/signin", "/site-admin/login"],
  });
  console.log(`[verify-cloudflare] ${name}: ${response.status}`);
}

async function createStagingSessionCookie() {
  const result = await createNextAuthSessionCookie({
    maxAge: 5 * 60,
    subjectPrefix: "verify",
  });
  return result.cookie;
}

async function checkAuthenticatedPublicRoute({ name, url, contains }) {
  const cookie = await createStagingSessionCookie();
  if (!cookie) {
    console.log(`[verify-cloudflare] ${name}: skipped authenticated route check`);
    return;
  }
  const response = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    headers: { cookie },
  });
  const location = response.headers.get("location") || "";
  if (response.status === 302 && isSiteLoginRedirect(location)) {
    if (process.env.VERIFY_CF_REQUIRE_STAGING_SYNTHETIC_AUTH === "1") {
      throw new Error(`${name} synthetic session was not accepted by staging`);
    }
    console.log(
      `[verify-cloudflare] ${name}: skipped authenticated route check (synthetic session not accepted)`,
    );
    return;
  }
  const text = await response.text();
  assert(response.status === 200, `${name} returned wrong authenticated status`, {
    url,
    status: response.status,
  });
  if (contains) {
    assert(text.includes(contains), `${name} route content drifted`, {
      url,
      contains,
    });
  }
  console.log(
    `[verify-cloudflare] ${name}: ${response.status} x-static-shell=${response.headers.get("x-static-shell") || ""}`,
  );
}

async function checkPublicRoute({ name, url, contains }) {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const text = await response.text();
  assert(response.status === 200, `${name} returned wrong status`, {
    url,
    status: response.status,
    expectedStatus: 200,
  });
  if (contains) {
    assert(text.includes(contains), `${name} route content drifted`, {
      url,
      contains,
    });
  }
  console.log(
    `[verify-cloudflare] ${name}: ${response.status} x-static-shell=${response.headers.get("x-static-shell") || ""}`,
  );
}

function wranglerStatus(envName) {
  const result = spawnSync(
    "npx",
    ["wrangler", "deployments", "status", "--env", envName],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    throw new Error(`wrangler deployments status failed for ${envName}\n${output}`);
  }
  return output;
}

async function verifyStaging() {
  const configured = String(
    process.env.VERIFY_CF_STAGING_ORIGIN ||
      process.env.SITE_ADMIN_BASE_URL_STAGING ||
      "",
  ).trim();
  const origin = (configured && !configured.includes(".workers.dev")
    ? configured
    : "https://staging.jinkunchen.com"
  ).replace(/\/+$/, "");
  await checkStagingLoginRedirect({
    name: "staging /",
    url: `${origin}/`,
  });
  await checkStagingLoginRedirect({
    name: "staging /blog",
    url: `${origin}/blog`,
  });
  await checkHttp({
    name: "staging /api/site-admin/status",
    url: `${origin}/api/site-admin/status`,
    expectedStatus: 401,
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /",
    url: `${origin}/`,
    contains: "Hi there!",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /blog",
    url: `${origin}/blog`,
    contains: "Blog",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /news",
    url: `${origin}/news`,
    contains: "News",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /publications",
    url: `${origin}/publications`,
    contains: "Publications",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /works",
    url: `${origin}/works`,
    contains: "Works",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /teaching",
    url: `${origin}/teaching`,
    contains: "Teaching",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /bio",
    url: `${origin}/bio`,
    contains: "BIO",
  });
  await checkAuthenticatedPublicRoute({
    name: "staging authenticated /connect",
    url: `${origin}/connect`,
    contains: "Connect",
  });
  const status = wranglerStatus("staging");
  assert(status.includes("Version(s):"), "staging deployment status missing version", {
    status,
  });
  console.log("[verify-cloudflare] staging deployment status ok");
}

async function verifyProduction(expectedVersion) {
  const origin = String(
    process.env.SITE_ADMIN_BASE_URL_PRODUCTION || "https://jinkunchen.com",
  ).replace(/\/+$/, "");
  await checkPublicRoute({
    name: "production /",
    url: `${origin}/`,
    contains: "Hi there!",
  });
  await checkPublicRoute({
    name: "production /blog",
    url: `${origin}/blog`,
    contains: "Blog",
  });
  await checkPublicRoute({
    name: "production /news",
    url: `${origin}/news`,
    contains: "News",
  });
  await checkPublicRoute({
    name: "production /publications",
    url: `${origin}/publications`,
    contains: "Publications",
  });
  await checkPublicRoute({
    name: "production /works",
    url: `${origin}/works`,
    contains: "Works",
  });
  await checkPublicRoute({
    name: "production /teaching",
    url: `${origin}/teaching`,
    contains: "Teaching",
  });
  await checkPublicRoute({
    name: "production /bio",
    url: `${origin}/bio`,
    contains: "BIO",
  });
  await checkPublicRoute({
    name: "production /connect",
    url: `${origin}/connect`,
    contains: "Connect",
  });
  await checkHttp({
    name: "production /api/site-admin/status",
    url: `${origin}/api/site-admin/status`,
    expectedStatus: 401,
  });
  const status = wranglerStatus("production");
  if (expectedVersion) {
    assert(
      status.includes(expectedVersion),
      "production active version changed unexpectedly",
      { expectedVersion, status },
    );
  }
  console.log("[verify-cloudflare] production deployment status ok");
}

async function main() {
  // Remote Cloudflare checks must use the deployed auth secret from `.env`.
  // `.env.local` may contain a local dev secret that cannot mint staging
  // cookies accepted by the Worker.
  loadProjectEnv({ override: true, files: [".env"] });
  const { env, expectedProductionVersion } = parseArgs();

  if (env === "staging" || env === "both") await verifyStaging();
  if (env === "production" || env === "both") {
    await verifyProduction(expectedProductionVersion);
  }

  console.log("[verify-cloudflare] passed");
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
