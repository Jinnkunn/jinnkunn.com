import openNextWorker from "../.open-next/worker.js";

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

async function fetchStaticAssetWithRedirects(request, env, assetPath) {
  const originUrl = new URL(request.url);
  originUrl.pathname = assetPath;

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
    // request flows through OpenNext and hits the Next.js middleware
    // (which enforces sign-in for all non-bypass paths). Without this,
    // pre-rendered HTML pages bypass middleware entirely.
    const gateEnabled = String(env?.STAGING_GATE || "") === "1";
    if (!gateEnabled && (method === "GET" || method === "HEAD")) {
      try {
        const staticRes = await tryServeStaticShell(request, env);
        if (staticRes) return staticRes;
      } catch {
        // Fall through to OpenNext runtime.
      }
    }
    return openNextWorker.fetch(request, env, ctx);
  },
};

export default worker;
