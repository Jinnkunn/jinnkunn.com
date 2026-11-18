import openNextWorker from "../.open-next/worker.js";
import {
  isStagingStaticShellAuthorized,
  parseCookieHeader,
} from "./staging-static-auth.mjs";
import {
  isStaticProtectionSatisfied,
  pickStaticProtectedRule,
} from "./static-shell-protection.mjs";
import { handleMobileSummaryRequest } from "./mobile-summary-direct.mjs";
import { workerOverlayKey, STATIC_POLICY_PATH } from "../lib/shared/static-release.ts";
import {
  isInternalStaticAssetPath,
  isRscRequest,
  normalizePathname,
  shouldBypassStatic,
} from "./worker-entry-guards.mjs";

function staticAssetPathForRoute(pathname) {
  const p = normalizePathname(pathname);
  if (p === "/") return ["/__static/index.html", "/__static/index", "/__static/"];
  return [`/__static${p}.html`, `/__static${p}/index.html`, `/__static${p}`];
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 307 || status === 308;
}

function cloneStaticRequest(original, targetUrl, method = original.method) {
  return new Request(targetUrl.toString(), {
    method,
    headers: original.headers,
    redirect: "manual",
  });
}

let staticProtectionPolicyPromise = null;
let staticProtectionPolicyLoadedAt = 0;
let staticOverlayManifest = null;
let staticOverlayManifestLoadedAt = 0;
const STATIC_OVERLAY_MANIFEST_TTL_MS = 5_000;

function staticOverlayEnabled(env) {
  return String(env?.STATIC_SHELL_OVERLAY || "") === "1";
}

function staticOverlayDb(env) {
  const db = env?.SITE_ADMIN_DB;
  return db && typeof db.prepare === "function" ? db : null;
}

async function loadStaticOverlayManifest(env) {
  if (!staticOverlayEnabled(env)) return null;
  const db = staticOverlayDb(env);
  if (!db) return null;
  const now = Date.now();
  if (
    staticOverlayManifest &&
    now - staticOverlayManifestLoadedAt < STATIC_OVERLAY_MANIFEST_TTL_MS
  ) {
    return staticOverlayManifest;
  }
  try {
    const result = await db
      .prepare("SELECT asset_path FROM static_shell_overlays")
      .all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    staticOverlayManifest = new Set(
      rows
        .map((row) => String(row?.asset_path || ""))
        .filter(
          (assetPath) =>
            assetPath.startsWith("/__static/") ||
            assetPath.startsWith("/_next/static/"),
        ),
    );
    staticOverlayManifestLoadedAt = now;
    return staticOverlayManifest;
  } catch {
    staticOverlayManifest = new Set();
    staticOverlayManifestLoadedAt = now;
    return staticOverlayManifest;
  }
}

async function fetchStaticOverlay(env, assetPath) {
  const manifest = await loadStaticOverlayManifest(env);
  if (!manifest || !manifest.has(assetPath)) return null;
  const db = staticOverlayDb(env);
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        `SELECT body, content_type, content_sha, updated_at
           FROM static_shell_overlays
          WHERE asset_path = ?
          LIMIT 1`,
      )
      .bind(assetPath)
      .first();
    if (!row || typeof row.body !== "string") return null;
    return row;
  } catch {
    return null;
  }
}

async function loadStaticProtectionPolicy(request, env) {
  const now = Date.now();
  if (
    !staticProtectionPolicyPromise ||
    now - staticProtectionPolicyLoadedAt >= STATIC_OVERLAY_MANIFEST_TTL_MS
  ) {
    staticProtectionPolicyLoadedAt = now;
    staticProtectionPolicyPromise = (async () => {
      const overlay = await fetchStaticOverlay(
        env,
        "/__static/protected-routes-policy.json",
      );
      if (overlay?.body) {
        try {
          return JSON.parse(overlay.body);
        } catch {
          // Fall through to bundled ASSETS.
        }
      }
      return loadBundledProtectionPolicy(request, env);
    })();
  }
  return staticProtectionPolicyPromise;
}

async function loadBundledProtectionPolicy(request, env) {
  const policyUrl = new URL(STATIC_POLICY_PATH, request.url);
  const res = await env.ASSETS.fetch(cloneStaticRequest(request, policyUrl, "GET"));
  return res?.ok ? res.json().catch(() => null) : null;
}

function resolveProtectedRouteSecret(env) {
  return (
    env?.SITE_PROTECTED_ROUTE_SECRET ||
    env?.NEXTAUTH_SECRET ||
    env?.AUTH_SECRET ||
    ""
  );
}

async function shouldDeferProtectedRouteToOpenNext(request, env, pathname) {
  const policy = await loadStaticProtectionPolicy(request, env);
  if (!policy) return true;
  const rule = pickStaticProtectedRule(pathname, policy);
  if (!rule) return false;
  return !(await isStaticProtectionSatisfied(
    rule,
    request.headers.get("cookie") || "",
    parseCookieHeader,
    resolveProtectedRouteSecret(env),
  ));
}

async function fetchStaticAssetWithRedirects(request, env, assetPath) {
  const originUrl = new URL(request.url);
  originUrl.pathname = assetPath;
  // Static shell asset keys do not include route query params such as ?theme=light.
  originUrl.search = "";

  let currentUrl = originUrl;
  let response = await env.ASSETS.fetch(cloneStaticRequest(request, currentUrl, "GET"));

  for (let i = 0; i < 2 && response && isRedirectStatus(response.status); i += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    currentUrl = new URL(location, currentUrl);
    response = await env.ASSETS.fetch(cloneStaticRequest(request, currentUrl, "GET"));
  }
  return response;
}

function overlayShellResponse(request, overlay, protectedRoute) {
  return new Response(request.method === "HEAD" ? null : overlay.body, { headers: {
    "content-type": overlay.content_type || "text/html; charset=utf-8",
    "cache-control": protectedRoute ? "private, no-store" : "public, max-age=0, must-revalidate",
    etag: `"${overlay.content_sha}"`,
    "x-static-shell": "1",
    "x-static-shell-path": overlay.asset_path,
    "x-static-overlay": "1",
    "x-publication-snapshot": overlay.publication_sha,
    vary: "RSC, Next-Router-Prefetch, Next-Router-State-Tree",
  } });
}

async function tryServeVersionedShell(request, env, key, pathname) {
  if (shouldBypassStatic(pathname)) return null;
  const [html, index, raw] = staticAssetPathForRoute(pathname);
  // One statement pins policy, route HTML, and bundled compatibility to the
  // same generation, even if a publication activates during this request.
  const row = await staticOverlayDb(env).prepare(`SELECT route.asset_path, route.body, route.content_type, route.content_sha,
    policy.body AS policy, json_extract(status.body, '$.bundledBuild') AS bundled_build,
    json_extract(status.body, '$.publicationSnapshotSha') AS publication_sha
    FROM static_shell_overlay_active a
    LEFT JOIN static_shell_overlay_versions policy ON policy.snapshot_id = a.snapshot_id AND policy.asset_path = ?
    LEFT JOIN static_shell_overlay_versions status ON status.snapshot_id = a.snapshot_id AND status.asset_path = '/__static/content-overlay-status.json'
    LEFT JOIN static_shell_overlay_versions route ON route.snapshot_id = a.snapshot_id AND route.asset_path IN (?, ?, ?)
    WHERE a.worker_version_id = ? ORDER BY CASE route.asset_path WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END LIMIT 1`)
    .bind(STATIC_POLICY_PATH, html, index, raw, key, html, index).first();
  const policy = row?.policy ? JSON.parse(row.policy) : null;
  if (!Array.isArray(policy?.rules) || !/^[a-f0-9]{64}$/.test(row.publication_sha)) throw new Error("Active publication is unavailable.");
  const rule = pickStaticProtectedRule(pathname, policy);
  if (rule && !await isStaticProtectionSatisfied(rule, request.headers.get("cookie") || "", parseCookieHeader, resolveProtectedRouteSecret(env))) {
    const bundled = await loadBundledProtectionPolicy(request, env);
    const bundledRule = bundled && pickStaticProtectedRule(pathname, bundled);
    if (bundledRule?.id === rule.id && bundledRule.auth === rule.auth && bundledRule.token === rule.token) return null;
    return new Response("This page requires access.", { status: 403, headers: { "cache-control": "private, no-store" } });
  }
  if (!row.asset_path) {
    // An omitted document must not reappear from the older bundled build.
    for (const assetPath of [html, index, raw]) {
      if ((await fetchStaticAssetWithRedirects(request, env, assetPath))?.ok) {
        return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
      }
    }
    return null;
  }
  if (isRscRequest(request)) {
    if (row.bundled_build) return null;
    // A content-only publication has no corresponding runtime RSC tree.
    // A non-RSC response makes Next fall back to a fresh document navigation.
    return new Response(null, { status: 409, headers: { "cache-control": "no-store", vary: "RSC, Next-Router-Prefetch, Next-Router-State-Tree" } });
  }
  return overlayShellResponse(request, row, Boolean(rule));
}

async function tryServeStaticShell(request, env) {
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (shouldBypassStatic(pathname)) return null;
  // An RSC payload request shares the page pathname; serving the HTML shell
  // here breaks client-side navigation.
  if (isRscRequest(request)) return null;
  if (await shouldDeferProtectedRouteToOpenNext(request, env, pathname)) return null;

  const assetPaths = staticAssetPathForRoute(pathname);
  for (const assetPath of assetPaths) {
    const overlay = await fetchStaticOverlay(env, assetPath);
    if (overlay?.body) {
      const headers = new Headers();
      headers.set(
        "content-type",
        String(overlay.content_type || "text/html; charset=utf-8"),
      );
      headers.set("cache-control", "public, max-age=0, must-revalidate");
      headers.set("etag", `"${String(overlay.content_sha || "")}"`);
      headers.set("x-static-shell", "1");
      headers.set("x-static-shell-path", assetPath);
      headers.set("x-static-overlay", "1");
      // The same URL yields HTML here and an RSC payload from OpenNext.
      headers.set("vary", "RSC, Next-Router-Prefetch, Next-Router-State-Tree");
      return new Response(request.method === "HEAD" ? null : overlay.body, {
        status: 200,
        headers,
      });
    }

    const res = await fetchStaticAssetWithRedirects(request, env, assetPath);
    if (!res || !res.ok) continue;

    const headers = new Headers(res.headers);
    headers.set("x-static-shell", "1");
    headers.set("x-static-shell-path", assetPath);
    headers.set("vary", "RSC, Next-Router-Prefetch, Next-Router-State-Tree");
    return new Response(request.method === "HEAD" ? null : res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
  return null;
}

async function tryServeNextStaticAsset(request, env) {
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith("/_next/static/")) return null;

  const key = workerOverlayKey(env);
  const overlay = key ? await staticOverlayDb(env).prepare(`SELECT v.body, v.content_type, v.content_sha
    FROM static_shell_overlay_active a JOIN static_shell_overlay_versions v
      ON v.snapshot_id IN (a.snapshot_id, a.previous_snapshot_id) AND v.asset_path = ?
    WHERE a.worker_version_id = ? ORDER BY v.snapshot_id = a.snapshot_id DESC LIMIT 1`).bind(pathname, key).first()
    : await fetchStaticOverlay(env, pathname);
  if (overlay?.body) {
    const headers = new Headers();
    headers.set(
      "content-type",
      String(overlay.content_type || "application/octet-stream"),
    );
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("etag", `"${String(overlay.content_sha || "")}"`);
    headers.set("x-static-overlay", "1");
    headers.set("x-static-overlay-path", pathname);
    return new Response(request.method === "HEAD" ? null : overlay.body, {
      status: 200,
      headers,
    });
  }

  const assetUrl = new URL(request.url);
  assetUrl.search = "";
  const bundled = await env.ASSETS.fetch(
    cloneStaticRequest(request, assetUrl, request.method),
  );
  if (!bundled?.ok) return null;
  return bundled;
}

const worker = {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/__admin/")) return new Response("Not found", { status: 404 });
    const method = String(request.method || "GET").toUpperCase();
    const url = new URL(request.url);
    const overlayKey = workerOverlayKey(env);
    // Reject direct hits on the internal shell key space before anything else.
    // `[assets] run_worker_first = ["/__static/*"]` in wrangler.toml routes these
    // here instead of letting the asset server answer them.
    if (isInternalStaticAssetPath(url.pathname)) {
      return new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const authorization = String(request.headers.get("authorization") || "").trim();
    if (
      normalizePathname(url.pathname) === "/api/site-admin/mobile/summary" &&
      /^Bearer\s+\S+/i.test(authorization)
    ) {
      return handleMobileSummaryRequest(request, env);
    }
    if (
      (method === "GET" || method === "HEAD") &&
      normalizePathname(url.pathname).startsWith("/_next/static/")
    ) {
      const staticAsset = await tryServeNextStaticAsset(request, env);
      if (staticAsset) return staticAsset;
    }
    // When `STAGING_GATE=1`, skip the static-asset shortcut so every
    // anonymous request flows through OpenNext and hits the Next.js
    // middleware. Authenticated public-page requests may still use the
    // static shell to avoid the Worker Free runtime hot path.
    const gateEnabled = String(env?.STAGING_GATE || "") === "1";
    if (method === "GET" || method === "HEAD") {
      try {
        if (!gateEnabled || (await isStagingStaticShellAuthorized(request, env))) {
          const staticRes = overlayKey
            ? await tryServeVersionedShell(request, env, overlayKey, normalizePathname(url.pathname))
            : await tryServeStaticShell(request, env);
          if (staticRes) return staticRes;
        }
      } catch {
        if (overlayKey) return new Response("Publication temporarily unavailable", { status: 503, headers: { "cache-control": "no-store" } });
        // Fall through to OpenNext runtime.
      }
    }
    return openNextWorker.fetch(request, env, ctx);
  },
};

export default worker;
