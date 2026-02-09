import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import protectedRoutes from "@/content/generated/protected-routes.json";
import routes from "@/content/generated/routes.json";
import { isSiteAdminAuthorized } from "@/lib/site-admin-auth";

type ProtectedRoute = {
  id: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

const pageIdToRoute: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  try {
    for (const [route, pageId] of Object.entries((routes || {}) as Record<string, unknown>)) {
      if (typeof pageId !== "string") continue;
      const k = pageId.replace(/-/g, "").toLowerCase();
      if (!k) continue;
      // Prefer the "shortest" route as canonical when duplicates exist (shouldn't).
      if (!out[k] || route.length < out[k]!.length) out[k] = route;
    }
  } catch {
    // ignore (missing routes.json in dev before first sync)
  }
  return out;
})();

function normalizePathname(pathname: string): string {
  const p = (pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function isBypassedPath(pathname: string): boolean {
  return (
    pathname === "/auth" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/styles/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/web_image/") ||
    pathname.startsWith("/notion-assets/") ||
    pathname.startsWith("/cdn-cgi/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

function findProtectedMatch(pathname: string, routes: ProtectedRoute[]): ProtectedRoute | null {
  const p = normalizePathname(pathname);

  // Prefer exact matches first.
  for (const r of routes) {
    if (r.mode !== "exact") continue;
    if (normalizePathname(r.path) === p) return r;
  }

  // Then longest prefix.
  let best: ProtectedRoute | null = null;
  for (const r of routes) {
    if (r.mode !== "prefix") continue;
    const rp = normalizePathname(r.path);
    if (rp === "/") continue;
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (!best || rp.length > normalizePathname(best.path).length) best = r;
    }
  }
  return best;
}

// NOTE: Next.js 16 deprecates `middleware.ts` in favor of `proxy.ts`.
// This proxy behaves like our previous middleware, handling:
// - blog URL canonicalization
// - Notion ID path canonicalization
// - optional password-protected routes
export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname || "/";
  if (isBypassedPath(pathname)) return NextResponse.next();

  // /site-admin must be protected (GitHub allowlist).
  if (pathname === "/site-admin/login" || pathname.startsWith("/site-admin/login/")) {
    return NextResponse.next();
  }
  if (pathname === "/site-admin" || pathname.startsWith("/site-admin/")) {
    const ok = await isSiteAdminAuthorized(req);
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/site-admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url, 302);
    }
  }

  // Canonicalize old blog URLs:
  // - /blog/list/<slug> -> /blog/<slug>
  // - /blog/list -> /blog
  if (pathname === "/blog/list" || pathname.startsWith("/blog/list/")) {
    const rest = pathname.replace(/^\/blog\/list\/?/, "");
    const url = req.nextUrl.clone();
    url.pathname = rest ? `/blog/${rest}` : "/blog";
    return NextResponse.redirect(url, 308);
  }

  // Some Notion structures expose a top-level `/list` database that backs the blog.
  // Keep the public URL space clean and canonicalize it to `/blog`.
  if (pathname === "/list" || pathname.startsWith("/list/")) {
    const rest = pathname.replace(/^\/list\/?/, "");
    const url = req.nextUrl.clone();
    url.pathname = rest ? `/blog/${rest}` : "/blog";
    return NextResponse.redirect(url, 308);
  }

  // Support old-style internal links that point to a Notion page id path
  // (e.g. "/<32hex>") by redirecting to the resolved route path.
  const idMatch = pathname.match(/^\/([0-9a-f]{32})(?:\/)?$/i);
  if (idMatch) {
    const id = idMatch[1]!.toLowerCase();
    const target = pageIdToRoute[id];
    if (target && target !== pathname) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url, 308);
    }
  }

  const rules = (protectedRoutes || []) as ProtectedRoute[];
  if (!Array.isArray(rules) || rules.length === 0) return NextResponse.next();

  const match = findProtectedMatch(pathname, rules);
  if (!match) return NextResponse.next();

  const cookieName = `site_auth_${match.id}`;
  const cookie = req.cookies.get(cookieName)?.value ?? "";
  if (cookie && cookie === match.token) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/auth";
  url.searchParams.set("next", pathname);
  url.searchParams.set("rid", match.id);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};
