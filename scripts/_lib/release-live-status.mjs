import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { readActiveDeployment } from "./cloudflare-api.mjs";
import { effectiveCodeSha } from "./deploy-metadata.mjs";
import { createNextAuthSessionCookie } from "./site-admin-auth-cookie.mjs";

export const DEFAULT_RELEASE_ROUTES = ["/", "/news", "/blog", "/calendar"];
export const PRODUCTION_HISTORY_PATH = "docs/runbooks/production-version-history.md";
const RUNTIME_CONTENT_INPUT_REL_PATHS = new Set(["content/now.json"]);

function run(command, args, options = {}) {
  const capture = Boolean(options.capture);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    throw new Error(`${options.label || [command, ...args].join(" ")} failed${output ? `\n${output}` : ""}`);
  }
  return output;
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function normalizeSha(value) {
  const raw = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/i.test(raw) ? raw : "";
}

function parsePorcelainPath(line) {
  const raw = String(line || "").slice(3).trim();
  const arrow = " -> ";
  return raw.includes(arrow) ? raw.split(arrow).at(-1).trim() : raw;
}

export function readGitState({ root }) {
  const sha = run("git", ["rev-parse", "HEAD"], {
    capture: true,
    cwd: root,
    label: "git rev-parse HEAD",
  }).trim();
  const branchRaw = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    capture: true,
    cwd: root,
    label: "git rev-parse --abbrev-ref HEAD",
  }).trim();
  const status = run("git", ["status", "--porcelain"], {
    capture: true,
    cwd: root,
    label: "git status --porcelain",
  });
  const dirtyFiles = status.split(/\r?\n/).filter(Boolean).map(parsePorcelainPath);
  return {
    sha,
    branch: branchRaw === "HEAD" ? "detached" : branchRaw,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    dirtyFileCount: dirtyFiles.length,
    productionHistoryOnlyDirty: isOnlyProductionHistoryDirty(dirtyFiles),
  };
}

export function isOnlyProductionHistoryDirty(files) {
  return files.length > 0 && files.every((file) => file === PRODUCTION_HISTORY_PATH);
}

function contentOnlyDiffFrom({ root, baseSha, headSha }) {
  if (!baseSha || !headSha || baseSha === headSha) return { ok: true, files: [] };
  let output = "";
  try {
    output = run("git", ["diff", "--name-only", `${baseSha}..${headSha}`], {
      capture: true,
      cwd: root,
      label: `git diff --name-only ${baseSha}..${headSha}`,
    });
  } catch (error) {
    return { ok: false, files: [], error: error?.message || String(error) };
  }
  const files = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    ok: files.every((file) => file.startsWith("content/")),
    files,
  };
}

function readTomlBlock({ root, marker }) {
  const raw = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const start = raw.indexOf(marker);
  if (start < 0) return "";
  const rest = raw.slice(start + marker.length);
  const nextBlock = rest.search(/\n\[/);
  return nextBlock >= 0 ? rest.slice(0, nextBlock) : rest;
}

function workerNameForEnv({ root, env }) {
  const explicit = env === "staging"
    ? readEnv("CLOUDFLARE_WORKER_NAME_STAGING")
    : readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION");
  if (explicit) return explicit;
  const block = readTomlBlock({ root, marker: `[env.${env}]` });
  const match = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
  return match?.[1] || (env === "staging" ? "jinnkunn-site-staging" : "jinnkunn-site");
}

function databaseIdForEnv({ root, env }) {
  const block = readTomlBlock({ root, marker: `[[env.${env}.d1_databases]]` });
  const match = /^\s*database_id\s*=\s*"([^"]+)"/m.exec(block);
  return match?.[1] || "";
}

function accountId() {
  return readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
}

function apiToken() {
  return readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
}

async function cfD1Query({ root, env, sql, params = [] }) {
  const cfAccount = accountId();
  const token = apiToken();
  const databaseId = databaseIdForEnv({ root, env });
  if (!cfAccount) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!databaseId) throw new Error(`Missing D1 database_id for ${env}`);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccount)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Cloudflare D1 returned non-JSON: ${text.slice(0, 240)}`);
  }
  if (!response.ok || payload?.success === false) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item.message).join("; ")
      : text;
    throw new Error(`Cloudflare D1 query failed (${response.status}): ${errors}`);
  }
  return payload?.result;
}

function d1Rows(result) {
  if (Array.isArray(result)) {
    for (const item of result) {
      if (Array.isArray(item?.results)) return item.results;
    }
  }
  if (Array.isArray(result?.results)) return result.results;
  return [];
}

function isMissingOverlayTableError(error) {
  return /no such table:\s*static_shell_overlay/i.test(String(error?.message || error));
}

function isMissingContentFilesTableError(error) {
  return /no such table:\s*content_files/i.test(String(error?.message || error));
}

async function readOverlayStatus({ root, env }) {
  try {
    const result = await cfD1Query({
      root,
      env,
      sql: "SELECT body FROM static_shell_overlays WHERE asset_path = ? LIMIT 1",
      params: ["/__static/content-overlay-status.json"],
    });
    const body = String(d1Rows(result)[0]?.body || "");
    if (!body) {
      return { ok: true, exists: false, snapshotSha: "", fileCount: 0 };
    }
    const parsed = JSON.parse(body);
    return {
      ok: parsed?.ok !== false,
      exists: true,
      ...parsed,
    };
  } catch (error) {
    if (isMissingOverlayTableError(error)) {
      return { ok: true, exists: false, snapshotSha: "", fileCount: 0 };
    }
    return {
      ok: false,
      exists: false,
      error: error?.message || String(error),
      snapshotSha: "",
      fileCount: 0,
    };
  }
}

async function readContentFileStatus({ root, env, relPath }) {
  try {
    const result = await cfD1Query({
      root,
      env,
      sql: `SELECT sha, updated_at
              FROM content_files
             WHERE rel_path = ?
             LIMIT 1`,
      params: [relPath],
    });
    const row = d1Rows(result)[0];
    if (!row) {
      return {
        ok: true,
        exists: false,
        relPath,
        sha: "",
        updatedAt: 0,
      };
    }
    return {
      ok: true,
      exists: true,
      relPath,
      sha: String(row.sha || ""),
      updatedAt: Number(row.updated_at || 0),
    };
  } catch (error) {
    if (isMissingContentFilesTableError(error)) {
      return {
        ok: true,
        exists: false,
        relPath,
        sha: "",
        updatedAt: 0,
      };
    }
    return {
      ok: false,
      exists: false,
      relPath,
      sha: "",
      updatedAt: 0,
      error: error?.message || String(error),
    };
  }
}

function buildNowPreview({ staging, production }) {
  const comparable = Boolean(staging?.ok && production?.ok);
  const stagingHasNow = Boolean(staging?.exists && staging?.sha);
  const productionHasNow = Boolean(production?.exists && production?.sha);
  return {
    current:
      comparable &&
      stagingHasNow &&
      productionHasNow &&
      staging.sha === production.sha,
    productionAction:
      !comparable
        ? "unknown"
        : !stagingHasNow
          ? "noop"
          : !productionHasNow || staging.sha !== production.sha
            ? "copy-staging-now"
            : "noop",
    staging,
    production,
  };
}

async function readDeployment({ root, env }) {
  const workerName = workerNameForEnv({ root, env });
  try {
    const active = await readActiveDeployment({
      accountId: accountId(),
      apiToken: apiToken(),
      workerName,
    });
    const codeSha = effectiveCodeSha(active?.meta);
    return {
      ok: Boolean(active && codeSha),
      env,
      workerName,
      versionId: String(active?.versionId || ""),
      deploymentId: String(active?.deploymentId || ""),
      codeSha,
      contentSha: normalizeSha(active?.meta?.contentSha) || normalizeSha(active?.meta?.sourceSha),
      contentBranch: String(active?.meta?.contentBranch || active?.meta?.sourceBranch || ""),
      meta: active?.meta || null,
      error: active && codeSha ? "" : "Active deployment metadata is missing code SHA.",
    };
  } catch (error) {
    return {
      ok: false,
      env,
      workerName,
      versionId: "",
      deploymentId: "",
      codeSha: "",
      contentSha: "",
      contentBranch: "",
      meta: null,
      error: error?.message || String(error),
    };
  }
}

function normalizeOrigin(env) {
  const explicit = env === "staging"
    ? readEnv("SITE_ADMIN_BASE_URL_STAGING") || readEnv("STAGING_ORIGIN")
    : readEnv("SITE_ORIGIN") || readEnv("PRODUCTION_ORIGIN");
  const fallback = env === "staging" ? "https://staging.jinkunchen.com" : "https://jinkunchen.com";
  const origin = String(explicit || fallback).replace(/\/+$/, "");
  if (env === "staging" && origin.includes(".workers.dev")) return fallback;
  return origin;
}

async function createStagingRouteAuth() {
  const auth = await createNextAuthSessionCookie({
    secret: readEnv("NEXTAUTH_SECRET") || readEnv("AUTH_SECRET"),
    maxAge: 5 * 60,
    subjectPrefix: "release-status",
  });
  return {
    cookie: auth.cookie,
    login: auth.identity?.value || "",
    ok: auth.ok,
    reason: auth.reason,
  };
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function hashContentInput(root) {
  const contentRoot = path.join(root, "content");
  if (!fs.existsSync(contentRoot)) return "";
  const files = [];
  function walk(absDir, relDir = "") {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (rel === "local" || rel.startsWith("local/")) continue;
      if (RUNTIME_CONTENT_INPUT_REL_PATHS.has(`content/${rel}`)) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        files.push({ abs, rel: `content/${rel}` });
      }
    }
  }
  walk(contentRoot);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const hash = crypto.createHash("sha1");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(fs.readFileSync(file.abs));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function extractMainHtml(html) {
  const match = /<main\b[^>]*>[\s\S]*?<\/main>/i.exec(String(html || ""));
  return match?.[0] || String(html || "");
}

function normalizeHtmlForParity(html) {
  return extractMainHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/https:\/\/staging\.jinkunchen\.com/gi, "__SITE_ORIGIN__")
    .replace(/https:\/\/jinkunchen\.com/gi, "__SITE_ORIGIN__")
    .replace(/\/_next\/static\/[^/"')\s]+/gi, "/_next/static/__BUILD_ID__")
    .replace(/\sdata-(?:react|next|n|rsc|flight)[a-z0-9_-]*(?:="[^"]*")?/gi, "")
    .replace(/\snonce="[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRoute({ env, pathname, stagingCookie = "" }) {
  const origin = normalizeOrigin(env);
  const cookie = env === "staging" ? stagingCookie : "";
  const response = await fetch(`${origin}${pathname}`, {
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  });
  const html = await response.text().catch(() => "");
  const normalized = normalizeHtmlForParity(html);
  return {
    env,
    path: pathname,
    status: response.status,
    location: response.headers.get("location") || "",
    staticShell: response.headers.get("x-static-shell") || "",
    staticOverlay: response.headers.get("x-static-overlay") || "",
    hash: sha1(normalized),
    bytes: html.length,
  };
}

function isStagingAuthRedirect(route) {
  const location = String(route?.location || "");
  return (
    route?.env === "staging" &&
    route?.status === 302 &&
    (location.includes("/api/auth/signin") ||
      location.includes("/site-admin/login"))
  );
}

async function compareRoutes(routes) {
  const rows = [];
  const stagingAuth = await createStagingRouteAuth();
  for (const pathname of routes) {
    const [staging, production] = await Promise.all([
      fetchRoute({ env: "staging", pathname, stagingCookie: stagingAuth.cookie }),
      fetchRoute({ env: "production", pathname }),
    ]);
    const authRedirect = isStagingAuthRedirect(staging);
    const skipped = !stagingAuth.ok && authRedirect;
    const authenticatedRedirect = stagingAuth.ok && authRedirect;
    rows.push({
      path: pathname,
      ok: skipped || (!authenticatedRedirect &&
        staging.status === 200 &&
        production.status === 200 &&
        staging.hash === production.hash),
      skipped,
      reason: skipped
        ? `Staging route requires an authenticated browser session: ${stagingAuth.reason}`
        : authenticatedRedirect
          ? "Authenticated staging route still redirected; check NEXTAUTH_SECRET and allowlist config."
          : "",
      staging,
      production,
    });
  }
  return {
    auth: {
      login: stagingAuth.login,
      reason: stagingAuth.reason,
      stagingAuthenticated: stagingAuth.ok,
    },
    ok: rows.every((row) => row.ok),
    mismatchCount: rows.filter((row) => !row.ok).length,
    checkedCount: rows.filter((row) => !row.skipped).length,
    skippedCount: rows.filter((row) => row.skipped).length,
    routes: rows,
  };
}

export function buildContentPreview({
  contentInputSha,
  git,
  production,
  productionOverlay,
  staging,
  stagingDiffFromLocal,
  stagingOverlay,
}) {
  const contentFiles = new Set();
  if (Array.isArray(stagingDiffFromLocal.files)) {
    for (const file of stagingDiffFromLocal.files) {
      if (file.startsWith("content/")) contentFiles.add(file);
    }
  }
  if (Array.isArray(git.dirtyFiles)) {
    for (const file of git.dirtyFiles) {
      if (file.startsWith("content/")) contentFiles.add(file);
    }
  }
  const files = Array.from(contentFiles).sort();
  const stagingOverlayCurrent =
    Boolean(stagingOverlay?.contentInputSha) &&
    stagingOverlay.contentInputSha === contentInputSha &&
    stagingOverlay.workerCodeSha === staging.codeSha;
  const stagingBundledCurrent =
    !stagingOverlay?.exists &&
    staging.contentSha === contentInputSha &&
    staging.codeSha === git.sha;
  const stagingCurrent = stagingOverlayCurrent || stagingBundledCurrent;
  const stagingBlockedByCode =
    !stagingDiffFromLocal.ok ||
    (staging.codeSha && git.sha && staging.codeSha !== git.sha && files.length === 0);
  const productionCanCopy =
    Boolean(stagingOverlay?.snapshotSha) &&
    production.codeSha === staging.codeSha;
  const productionBundledCurrent =
    !productionOverlay?.exists &&
    !stagingOverlay?.exists &&
    production.contentSha === contentInputSha &&
    production.codeSha === staging.codeSha;
  const productionCurrent =
    productionBundledCurrent ||
    (productionCanCopy && stagingOverlay.snapshotSha === productionOverlay?.snapshotSha);

  return {
    contentInputSha,
    files: files.slice(0, 12),
    fileCount: files.length,
    truncated: files.length > 12,
    staging: {
      action: stagingCurrent ? "noop" : stagingBlockedByCode ? "deploy-code-first" : "publish-overlay",
      current: stagingCurrent,
      workerCodeSha: staging.codeSha,
      overlayContentInputSha: stagingOverlay?.contentInputSha || "",
      overlaySnapshotSha: stagingOverlay?.snapshotSha || "",
    },
    production: {
      action: productionCurrent
        ? "noop"
        : productionCanCopy
          ? "copy-staging-overlay"
          : production.codeSha === staging.codeSha
            ? "wait-for-staging-overlay"
            : "promote-code-first",
      current: productionCurrent,
      workerCodeSha: production.codeSha,
      overlaySnapshotSha: productionOverlay?.snapshotSha || "",
      stagingOverlaySnapshotSha: stagingOverlay?.snapshotSha || "",
    },
  };
}

export function deriveLiveReleasePlan({ status, target = "production", contentChanged = false }) {
  const git = status.git;
  const staging = status.deployments.staging;
  const production = status.deployments.production;
  const stagingOverlay = status.overlays.staging.status;
  const productionOverlay = status.overlays.production.status;
  const nonBlockingDirty = git.productionHistoryOnlyDirty;
  const stagingOverlayCoversLocalContent =
    status.stagingDiffFromLocal.ok &&
    Boolean(stagingOverlay?.contentInputSha) &&
    stagingOverlay.contentInputSha === status.contentInputSha &&
    stagingOverlay.workerCodeSha === staging.codeSha;

  if (git.branch !== "main") {
    return {
      kind: "blocked",
      label: "Blocked",
      script: "",
      reason: `Current branch is ${git.branch}, not main.`,
    };
  }
  if (git.dirty && !nonBlockingDirty) {
    return {
      kind: "blocked",
      label: "Commit changes",
      script: "",
      reason: "Working tree has release-affecting changes.",
      dirtyFiles: git.dirtyFiles,
    };
  }
  if (!staging.ok || !staging.codeSha) {
    return {
      kind: "deploy-staging-code",
      label: "Deploy Staging",
      script: "release:staging",
      reason: staging.error || "Staging deployment metadata is missing.",
    };
  }
  if (staging.codeSha !== git.sha) {
    if (status.stagingDiffFromLocal.ok && !stagingOverlayCoversLocalContent) {
      return {
        kind: "publish-content-staging",
        label: "Publish Staging Content",
        script: "publish:content:staging",
        reason: "Local HEAD differs from staging only in content files.",
      };
    }
    if (!status.stagingDiffFromLocal.ok) {
      return {
        kind: "deploy-staging-code",
        label: "Deploy Staging",
        script: "release:staging",
        reason: "Staging code is behind local HEAD.",
        changedFiles: status.stagingDiffFromLocal.files,
      };
    }
  }
  if (contentChanged && !stagingOverlayCoversLocalContent) {
    return {
      kind: "publish-content-staging",
      label: "Publish Staging Content",
      script: "publish:content:staging",
      reason: "Saved content changed; staging publish is the first step.",
    };
  }
  if (target === "staging") {
    return {
      kind: "noop",
      label: "Staging Current",
      script: "",
      reason: "No staging release work is needed.",
    };
  }
  if (!production.ok || production.codeSha !== staging.codeSha) {
    return {
      kind: "promote-production-code",
      label: "Promote Production",
      script: "release:prod:from-staging",
      reason: "Production code differs from the verified staging candidate.",
    };
  }
  if (
    stagingOverlay?.snapshotSha &&
    stagingOverlay.snapshotSha !== productionOverlay?.snapshotSha
  ) {
    return {
      kind: "publish-content-production-from-staging",
      label: "Publish Same Content to Production",
      script: "publish:content:prod:from-staging",
      reason: "Production content overlay is behind staging.",
    };
  }
  if (status.now?.productionAction === "copy-staging-now") {
    return {
      kind: "publish-now-production-from-staging",
      label: "Publish Now to Live",
      script: "publish:now:prod:from-staging",
      reason: "The Now status is newer on staging.",
    };
  }
  if (status.routeParity && !status.routeParity.ok) {
    if (!stagingOverlay?.snapshotSha) {
      return {
        kind: "publish-content-staging",
        label: "Publish Staging Content",
        script: "publish:content:staging",
        reason: `${status.routeParity.mismatchCount} checked route${status.routeParity.mismatchCount === 1 ? "" : "s"} differ, and staging has no verified content overlay snapshot yet.`,
      };
    }
    return {
      kind: "blocked",
      label: "Route mismatch",
      script: "",
      reason: `${status.routeParity.mismatchCount} public route parity check${status.routeParity.mismatchCount === 1 ? "" : "s"} differ after code/content matched.`,
    };
  }
  return {
    kind: "noop",
    label: "Current",
    script: "",
    reason: status.routeParity?.skippedCount
      ? "Code and overlays match; route parity needs an authenticated staging browser session to compare gated pages."
      : "Staging and production match for code, overlay, and checked routes.",
  };
}

export async function buildLiveReleaseStatus({
  root,
  target = "production",
  routes = DEFAULT_RELEASE_ROUTES,
  contentChanged = false,
  includeRoutes = true,
} = {}) {
  const git = readGitState({ root });
  const [
    staging,
    production,
    stagingOverlay,
    productionOverlay,
    stagingNow,
    productionNow,
  ] = await Promise.all([
    readDeployment({ root, env: "staging" }),
    readDeployment({ root, env: "production" }),
    readOverlayStatus({ root, env: "staging" }),
    readOverlayStatus({ root, env: "production" }),
    readContentFileStatus({ root, env: "staging", relPath: "now.json" }),
    readContentFileStatus({ root, env: "production", relPath: "now.json" }),
  ]);
  const contentInputSha = hashContentInput(root);
  const stagingDiffFromLocal = contentOnlyDiffFrom({
    root,
    baseSha: staging.codeSha,
    headSha: git.sha,
  });
  let routeParity = null;
  if (includeRoutes) {
    try {
      routeParity = await compareRoutes(routes);
    } catch (error) {
      routeParity = {
        ok: false,
        mismatchCount: routes.length,
        error: error?.message || String(error),
        routes: [],
      };
    }
  }
  const status = {
    ok: true,
    target,
    checkedAt: new Date().toISOString(),
    git,
    deployments: { staging, production },
    contentInputSha,
    overlays: {
      staging: { status: stagingOverlay },
      production: { status: productionOverlay },
    },
    now: buildNowPreview({ staging: stagingNow, production: productionNow }),
    stagingDiffFromLocal,
    routeParity,
  };
  status.contentPreview = buildContentPreview({
    contentInputSha,
    git,
    production,
    productionOverlay,
    staging,
    stagingDiffFromLocal,
    stagingOverlay,
  });
  return {
    ...status,
    plan: deriveLiveReleasePlan({ status, target, contentChanged }),
  };
}
