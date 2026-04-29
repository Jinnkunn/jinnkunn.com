#!/usr/bin/env node

// Post-deploy smoke check. Replaces the `curl /robots.txt` one-liner the
// release-from-dispatch workflow used to run, which only proved the
// edge could route — it would happily report "OK" while every actual
// page 5xx'd. This walks a small set of real routes and asserts that
// each response status + a few well-known HTML markers are present, so
// a worker that boots but routes wrong doesn't silently sail past
// "deployment succeeded".
//
// Usage:
//   node scripts/smoke-deployed.mjs --env=staging
//   node scripts/smoke-deployed.mjs --env=production
//
// Env vars consumed:
//   NEXTAUTH_SECRET, SITE_ADMIN_GITHUB_USERS  — used to mint a synthetic
//     staging session cookie (staging-gate is on for non-public routes).
//     If either is missing, the staging-gated routes are skipped with a
//     warning rather than failing — production has no gate so its routes
//     work without auth either way.
//
// Exits 0 on success, non-zero with details on any failure.

import { encode } from "next-auth/jwt";

import { loadProjectEnv } from "./load-project-env.mjs";

const ENVIRONMENTS = new Set(["staging", "production"]);
const RETRY_DELAY_MS = 6000;
const MAX_RETRIES = 3;

const STAGING_URL = "https://staging.jinkunchen.com";
const PRODUCTION_URL = "https://jinkunchen.com";

function parseArgs(argv = process.argv.slice(2)) {
  const envArg =
    argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ||
    process.env.SMOKE_DEPLOYED_ENV ||
    "staging";
  const env = ENVIRONMENTS.has(envArg) ? envArg : "staging";
  return { env };
}

function originFor(env) {
  return env === "production" ? PRODUCTION_URL : STAGING_URL;
}

// Assertions per route. Each entry produces one HTTP fetch; the matcher
// runs against the response body. Markers are short, stable strings — a
// `<title>`, a footer label, etc. — picked so a renderer regression that
// drops the right shell would fail here even when status is 200.
const ROUTES = [
  { path: "/robots.txt", contains: "User-agent" },
  { path: "/llms.txt", contains: "Jinkun" },
  { path: "/sitemap.xml", contains: "<loc>" },
  { path: "/", contains: "Jinkun" },
  { path: "/blog", contains: "Jinkun" },
  { path: "/publications", contains: "Jinkun" },
  { path: "/calendar", contains: "Jinkun" },
];

function normalizeGithubLogin(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function firstAllowedGithubUser() {
  const raw = String(process.env.SITE_ADMIN_GITHUB_USERS || "");
  for (const part of raw.split(/[,\n]/)) {
    const login = normalizeGithubLogin(part);
    if (login) return login;
  }
  return "";
}

async function maybeMintStagingCookie() {
  const secret = String(
    process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "",
  ).trim();
  const login = firstAllowedGithubUser();
  if (!secret || !login) return "";
  const token = await encode({
    token: { sub: `smoke-${login}`, login, name: login },
    secret,
    maxAge: 5 * 60,
  });
  return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
}

async function fetchOnce(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: "follow",
    cache: "no-store",
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function fetchWithRetry(url, headers) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await fetchOnce(url, headers);
      // Accept anything in the success / known-redirect band as
      // "the worker responded coherently", and only retry on transient
      // 5xx — staging-gate sometimes 302-redirects unauthenticated
      // requests to /site-admin/login, which is fine for smoke purposes.
      if (result.status < 500) return result;
      lastError = `status=${result.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw new Error(`fetch ${url} failed after ${MAX_RETRIES} tries: ${lastError}`);
}

async function main() {
  loadProjectEnv({ override: true });
  const { env } = parseArgs();
  const origin = originFor(env);

  // Staging routes go behind STAGING_GATE; production is open. We mint
  // a short-lived synthetic cookie so authenticated routes work. If
  // creds are missing in env, gated routes degrade to status-only (a
  // 302 → /site-admin/login response is still "the worker booted").
  const cookie = env === "staging" ? await maybeMintStagingCookie() : "";
  const headers = cookie
    ? { cookie, "user-agent": "release-from-dispatch/smoke-deployed" }
    : { "user-agent": "release-from-dispatch/smoke-deployed" };

  if (env === "staging" && !cookie) {
    console.log(
      "[smoke-deployed] no synthetic cookie (NEXTAUTH_SECRET / SITE_ADMIN_GITHUB_USERS missing); checking response status only on gated routes",
    );
  }

  const failures = [];
  for (const route of ROUTES) {
    const url = `${origin}${route.path}`;
    try {
      const { status, text } = await fetchWithRetry(url, headers);
      const ok =
        status >= 200 && status < 400 && (cookie || env === "production"
          ? text.includes(route.contains)
          : true);
      if (!ok) {
        failures.push({
          route: route.path,
          status,
          reason: text.includes(route.contains)
            ? `unexpected status ${status}`
            : `body missing marker "${route.contains}"`,
        });
        console.log(
          `[smoke-deployed] ✗ ${route.path}: status=${status} ${
            text.includes(route.contains) ? "" : `(missing "${route.contains}")`
          }`,
        );
      } else {
        console.log(
          `[smoke-deployed] ✓ ${route.path}: status=${status}${cookie || env === "production" ? ` body has "${route.contains}"` : ""}`,
        );
      }
    } catch (error) {
      failures.push({
        route: route.path,
        status: 0,
        reason: error?.message || String(error),
      });
      console.log(`[smoke-deployed] ✗ ${route.path}: ${error?.message || error}`);
    }
  }

  if (failures.length > 0) {
    console.error(`[smoke-deployed] ${failures.length} route(s) failed on ${origin}`);
    for (const failure of failures) {
      console.error(
        `  - ${failure.route} (status=${failure.status}): ${failure.reason}`,
      );
    }
    process.exit(1);
  }

  console.log(`[smoke-deployed] ${ROUTES.length} routes ok on ${origin}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
