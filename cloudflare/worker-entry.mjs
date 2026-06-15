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

const BYPASS_PREFIXES = [
  "/api/",
  "/site-admin",
  "/auth",
  "/_next/",
  "/assets/",
  "/styles/",
  "/fonts/",
  "/web_image/",
  "/notion-assets/",
  "/cdn-cgi/",
  "/.well-known/",
];

function hasLikelyFileExtension(pathname) {
  const last = pathname.split("/").pop() || "";
  return last.includes(".");
}

function isRuntimeContentRoute(pathname) {
  if (pathname === "/") return true;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return true;
  if (pathname === "/publications") return true;
  if (pathname.startsWith("/pages/")) return true;
  if (pathname === "/calendar" || pathname === "/now" || pathname === "/sitemap") {
    return false;
  }
  if (pathname.startsWith("/calendar/")) return true;
  return !hasLikelyFileExtension(pathname);
}

function shouldBypassStatic(pathname) {
  if (!pathname) return true;
  if (isRuntimeContentRoute(pathname)) return true;
  if (pathname === "/blog/list" || pathname.startsWith("/blog/list/")) return true;
  if (/^\/[0-9a-f]{32}$/i.test(pathname)) return true;
  for (const prefix of BYPASS_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return true;
  }
  return hasLikelyFileExtension(pathname);
}

function normalizePathname(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw || raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.replace(/\/+$/, "") || "/";
}

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
        .filter((assetPath) => assetPath.startsWith("/__static/")),
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
      const policyUrl = new URL(request.url);
      policyUrl.pathname = "/__static/protected-routes-policy.json";
      policyUrl.search = "";
      const res = await env.ASSETS.fetch(cloneStaticRequest(request, policyUrl, "GET"));
      if (!res || !res.ok) return null;
      return res.json().catch(() => null);
    })();
  }
  return staticProtectionPolicyPromise;
}

async function shouldDeferProtectedRouteToOpenNext(request, env, pathname) {
  const policy = await loadStaticProtectionPolicy(request, env);
  if (!policy) return true;
  const rule = pickStaticProtectedRule(pathname, policy);
  if (!rule) return false;
  return !isStaticProtectionSatisfied(
    rule,
    request.headers.get("cookie") || "",
    parseCookieHeader,
  );
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

async function tryServeStaticShell(request, env) {
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (shouldBypassStatic(pathname)) return null;
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
    return new Response(request.method === "HEAD" ? null : res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
  return null;
}

const worker = {
  async fetch(request, env, ctx) {
    const method = String(request.method || "GET").toUpperCase();
    const url = new URL(request.url);
    if (normalizePathname(url.pathname) === "/api/site-admin/mobile/summary") {
      return handleMobileSummaryRequest(request, env);
    }
    // When `STAGING_GATE=1`, skip the static-asset shortcut so every
    // anonymous request flows through OpenNext and hits the Next.js
    // middleware. Authenticated public-page requests may still use the
    // static shell to avoid the Worker Free runtime hot path.
    const gateEnabled = String(env?.STAGING_GATE || "") === "1";
    if (method === "GET" || method === "HEAD") {
      try {
        if (!gateEnabled || (await isStagingStaticShellAuthorized(request, env))) {
          const staticRes = await tryServeStaticShell(request, env);
          if (staticRes) return staticRes;
        }
      } catch {
        // Fall through to OpenNext runtime.
      }
    }
    return openNextWorker.fetch(request, env, ctx);
  },
};

export default worker;
