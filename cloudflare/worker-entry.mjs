import openNextWorker from "../.open-next/worker.js";
import {
  isStagingStaticShellAuthorized,
  parseCookieHeader,
} from "./staging-static-auth.mjs";
import {
  isStaticProtectionSatisfied,
  pickStaticProtectedRule,
} from "./static-shell-protection.mjs";

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

function shouldBypassStatic(pathname) {
  if (!pathname) return true;
  if (pathname === "/") return false;
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

function cloneStaticRequest(original, targetUrl) {
  return new Request(targetUrl.toString(), {
    method: original.method,
    headers: original.headers,
    redirect: "manual",
  });
}

let staticProtectionPolicyPromise = null;

async function loadStaticProtectionPolicy(request, env) {
  if (!staticProtectionPolicyPromise) {
    staticProtectionPolicyPromise = (async () => {
      const policyUrl = new URL(request.url);
      policyUrl.pathname = "/__static/protected-routes-policy.json";
      policyUrl.search = "";
      const res = await env.ASSETS.fetch(cloneStaticRequest(request, policyUrl));
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
  let response = await env.ASSETS.fetch(cloneStaticRequest(request, currentUrl));

  for (let i = 0; i < 2 && response && isRedirectStatus(response.status); i += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    currentUrl = new URL(location, currentUrl);
    response = await env.ASSETS.fetch(cloneStaticRequest(request, currentUrl));
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
    const res = await fetchStaticAssetWithRedirects(request, env, assetPath);
    if (!res || !res.ok) continue;

    const headers = new Headers(res.headers);
    headers.set("x-static-shell", "1");
    headers.set("x-static-shell-path", assetPath);
    return new Response(res.body, {
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
