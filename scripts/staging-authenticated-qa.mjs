#!/usr/bin/env node

import fs from "node:fs/promises";

import { encode } from "next-auth/jwt";

import { loadProjectEnv } from "./load-project-env.mjs";

const DEFAULT_ROUTES = [
  { path: "/", contains: "Hi there!" },
  { path: "/news", contains: "News" },
  { path: "/publications", contains: "Publications" },
  { path: "/works", contains: "Works" },
  { path: "/teaching", contains: "Teaching" },
  { path: "/teaching/archive", contains: "CSCI3141", minBreadcrumbs: 3 },
  {
    path: "/teaching/archive/2024-25-fall/csci3141",
    contains: "Enter the password",
    protected: true,
  },
  { path: "/blog", contains: "Blog" },
  { path: "/bio", contains: "BIO" },
  { path: "/connect", contains: "Connect" },
];

const API_READ_CHECKS = [
  {
    label: "home",
    path: "/api/site-admin/home",
    summarize(payload) {
      const data = requireRecord(payload.data, "home data");
      requireSourceVersion(payload.sourceVersion, "home");
      assert(typeof data.title === "string", "home title is not a string", { data });
      if (data.bodyMdx !== undefined) {
        assert(typeof data.bodyMdx === "string", "home bodyMdx is not a string", { data });
      }
      return `title=${data.title}`;
    },
  },
  {
    label: "page-tree",
    path: "/api/site-admin/pages/tree",
    summarize(payload) {
      const slugs = requireArray(payload.slugs, "page tree slugs");
      requireSourceVersion(payload.sourceVersion, "page-tree");
      return `slugs=${slugs.length}`;
    },
  },
  {
    label: "posts",
    path: "/api/site-admin/posts?drafts=1",
    summarize(payload) {
      const posts = requireArray(payload.posts, "posts");
      const count = requireNumber(payload.count, "posts count");
      assert(count === posts.length, "posts count does not match list length", {
        count,
        listLength: posts.length,
      });
      return `count=${count}`;
    },
  },
  {
    label: "pages",
    path: "/api/site-admin/pages?drafts=1",
    summarize(payload) {
      const pages = requireArray(payload.pages, "pages");
      const count = requireNumber(payload.count, "pages count");
      assert(count === pages.length, "pages count does not match list length", {
        count,
        listLength: pages.length,
      });
      return `count=${count}`;
    },
  },
];

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  const origin = raw && !raw.includes(".workers.dev") ? raw : "https://staging.jinkunchen.com";
  return origin.replace(/\/+$/, "");
}

function normalizeGithubLogin(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function firstAllowedGithubUser() {
  for (const part of String(process.env.SITE_ADMIN_GITHUB_USERS || "").split(/[,\n]/)) {
    const login = normalizeGithubLogin(part);
    if (login) return login;
  }
  return "";
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length
    ? `\n${JSON.stringify(details, null, 2)}`
    : "";
  throw new Error(`${message}${suffix}`);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} is not an object`, { value });
  return value;
}

function requireArray(value, label) {
  assert(Array.isArray(value), `${label} is not an array`, { value });
  return value;
}

function requireNumber(value, label) {
  assert(Number.isFinite(value), `${label} is not a number`, { value });
  return value;
}

function requireSourceVersion(value, label) {
  const sourceVersion = requireRecord(value, `${label} sourceVersion`);
  assert(
    typeof sourceVersion.fileSha === "string" ||
      typeof sourceVersion.branchSha === "string" ||
      typeof sourceVersion.siteConfigSha === "string",
    `${label} sourceVersion does not include a known sha field`,
    { sourceVersion },
  );
  return sourceVersion;
}

async function createSessionCookie() {
  const secret = String(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  const login = firstAllowedGithubUser();
  assert(secret, "NEXTAUTH_SECRET or AUTH_SECRET is required");
  assert(login, "SITE_ADMIN_GITHUB_USERS must include at least one GitHub login");

  const token = await encode({
    secret,
    token: {
      sub: `staging-authenticated-qa-${login}`,
      login,
      name: login,
    },
    maxAge: 5 * 60,
  });
  return `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`;
}

async function checkStaticRoute({
  origin,
  cookie,
  path,
  contains,
  minBreadcrumbs = 0,
  protected: isProtected = false,
}) {
  const url = `${origin}${path}`;
  const res = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    headers: { cookie },
  });
  const text = await res.text();
  const staticShell = res.headers.get("x-static-shell") || "";
  const staticPath = res.headers.get("x-static-shell-path") || "";
  console.log(
    `[staging-authenticated-qa] ${path}: ${res.status} x-static-shell=${staticShell} ${staticPath}`,
  );
  assert(res.status === 200, "route returned wrong status", { path, status: res.status });
  if (isProtected) {
    assert(staticShell !== "1", "protected route bypassed middleware via static shell", {
      path,
      staticShell,
      staticPath,
    });
  } else {
    assert(staticShell === "1", "route did not use static shell", { path, staticShell, staticPath });
  }
  if (contains) {
    assert(text.includes(contains), "route content check failed", { path, contains });
  }
  if (minBreadcrumbs > 0) {
    const breadcrumbCount = (text.match(/notion-breadcrumb__item/g) || []).length;
    assert(breadcrumbCount >= minBreadcrumbs, "route breadcrumb check failed", {
      path,
      breadcrumbCount,
      minBreadcrumbs,
    });
  }
}

async function checkStatus({ origin, cookie }) {
  const res = await fetch(`${origin}/api/site-admin/status`, {
    cache: "no-store",
    headers: { cookie },
  });
  const raw = await res.json().catch(() => null);
  const source = raw?.data?.source || raw?.source || null;
  console.log(
    `[staging-authenticated-qa] status: ${res.status} pendingDeploy=${String(
      source?.pendingDeploy,
    )} branch=${source?.branch || ""}`,
  );
  assert(res.status === 200, "status endpoint returned wrong status", { status: res.status, raw });
  assert(source && typeof source === "object", "status payload missing source", { raw });
  assert(source.pendingDeploy !== true, "staging source is pending deploy", { source });
  assert(
    source.deployableVersionReady !== false,
    "staging deployable Worker candidate is stale",
    { source },
  );
}

async function fetchApiPayload({ origin, cookie, path }) {
  const res = await fetch(`${origin}${path}`, {
    cache: "no-store",
    headers: { cookie },
  });
  const raw = await res.json().catch(() => null);
  assert(res.status === 200, "api endpoint returned wrong status", {
    path,
    status: res.status,
    raw,
  });
  assert(raw?.ok === true, "api endpoint returned non-ok payload", { path, raw });
  return requireRecord(raw.data, `${path} payload`);
}

async function checkSiteAdminReadApis({ origin, cookie }) {
  for (const check of API_READ_CHECKS) {
    const payload = await fetchApiPayload({ origin, cookie, path: check.path });
    const summary = check.summarize(payload);
    console.log(`[staging-authenticated-qa] api/${check.label}: 200 ${summary}`);
  }
}

function normalizeStylesheets(raw) {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw) && "stylesheets" in raw
      ? raw.stylesheets
      : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

async function checkHomePreview({ origin, cookie }) {
  const home = JSON.parse(await fs.readFile("content/home.json", "utf8"));
  const res = await fetch(`${origin}/api/site-admin/preview/home`, {
    method: "POST",
    cache: "no-store",
    headers: {
      cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ data: home }),
  });
  const raw = await res.json().catch(() => null);
  const data = raw?.data || raw || null;
  const stylesheets = normalizeStylesheets(data?.stylesheets);
  console.log(
    `[staging-authenticated-qa] preview/home: ${res.status} stylesheets=${stylesheets.length}`,
  );
  assert(res.status === 200, "preview/home returned wrong status", { status: res.status, raw });
  assert(typeof data?.html === "string" && data.html.length > 0, "preview/home missing html", {
    raw,
  });
  assert(stylesheets.length > 0, "preview/home returned no stylesheets", { raw });
  for (const href of stylesheets) {
    assert(
      /^\/_next\/static\/css\/.+\.css$/.test(href),
      "preview/home stylesheet is not a Next static CSS asset",
      { href, stylesheets },
    );
  }
}

async function main() {
  // Use deployed remote secrets from `.env`; `.env.local` may intentionally
  // contain a local dev auth secret that staging cannot validate.
  loadProjectEnv({ override: false, files: [".env"] });

  const origin = normalizeOrigin(
    argValue("origin") ||
      process.env.STAGING_AUTH_QA_ORIGIN ||
      process.env.VERIFY_CF_STAGING_ORIGIN ||
      process.env.SITE_ADMIN_BASE_URL_STAGING,
  );
  const cookie = await createSessionCookie();

  for (const route of DEFAULT_ROUTES) {
    await checkStaticRoute({ origin, cookie, ...route });
  }
  await checkStatus({ origin, cookie });
  await checkSiteAdminReadApis({ origin, cookie });
  await checkHomePreview({ origin, cookie });

  console.log("[staging-authenticated-qa] passed");
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
