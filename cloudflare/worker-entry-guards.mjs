// Pure request-path guards shared by the Worker entrypoint and its tests.
// Kept out of worker-entry.mjs so tests can import them without pulling in
// `../.open-next/worker.js`, which only exists after a Cloudflare build.

export function normalizePathname(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw || raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.replace(/\/+$/, "") || "/";
}

// `/__static/*` is the internal key space the Worker reads through
// `env.ASSETS.fetch()`. It must never be addressable from outside: serving it
// directly would hand out prerendered HTML for password-protected routes
// without ever running `shouldDeferProtectedRouteToOpenNext`.
export function isInternalStaticAssetPath(pathname) {
  const p = normalizePathname(pathname);
  return p === "/__static" || p.startsWith("/__static/");
}

// React Server Component payload requests share the page's pathname and are
// distinguished only by the `RSC` header / `_rsc` query param. Answering them
// with the prerendered HTML shell makes the router fall back to a hard
// navigation and makes every <Link> prefetch download a whole document, so
// these must always reach the OpenNext runtime.
export function isRscRequest(request) {
  if (!request) return false;
  const headers = request.headers;
  if (headers && typeof headers.get === "function") {
    if (headers.get("rsc")) return true;
    if (headers.get("next-router-prefetch")) return true;
    if (headers.get("next-router-state-tree")) return true;
  }
  try {
    return new URL(request.url).searchParams.has("_rsc");
  } catch {
    return false;
  }
}
