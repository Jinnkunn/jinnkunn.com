import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import protectedRoutes from "@/content/generated/protected-routes.json";
import routesManifest from "@/content/generated/routes-manifest.json";
import routes from "@/content/generated/routes.json";
import { isContentGithubAuthorized } from "@/lib/content-auth";
import {
  buildParentByPageIdMap,
  canonicalizePublicRoute,
  normalizePathname,
  pickProtectedRule,
  resolveNotionIdPathRedirect,
} from "@/lib/routes/strategy";
import { isSiteAdminAuthorized } from "@/lib/site-admin-auth";

type ProtectedRoute = {
  id: string;
  auth?: "password" | "github";
  key?: "pageId" | "path";
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

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

const parentByPageId: Record<string, string> = (() => {
  return buildParentByPageIdMap(routesManifest as unknown);
})();

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
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/cdn-cgi/") ||
    pathname === "/favicon.ico" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/apple-touch-icon-precomposed.png" ||
    pathname === "/site.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname === "/browserconfig.xml" ||
    pathname === "/safari-pinned-tab.svg" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}


// NOTE: Next.js 16 deprecates `middleware.ts` in favor of `proxy.ts`.
// This proxy behaves like our previous middleware, handling:
// - blog URL canonicalization
// - Notion ID path canonicalization
// - optional password-protected routes
export async function proxy(req: NextRequest) {
  const pathname = normalizePathname(req.nextUrl.pathname || "/");
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
  {
    const canon = canonicalizePublicRoute(pathname);
    if (canon && canon !== pathname) {
      const url = req.nextUrl.clone();
      url.pathname = canon;
      return NextResponse.redirect(url, 308);
    }
  }

  // Support old-style internal links that point to a Notion page id path
  // (e.g. "/<32hex>") by redirecting to the resolved route path.
  {
    const target = resolveNotionIdPathRedirect(pathname, pageIdToRoute);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url, 308);
    }
  }

  const rules = (protectedRoutes || []) as ProtectedRoute[];
  if (!Array.isArray(rules) || rules.length === 0) return NextResponse.next();

  const routesMap: Record<string, unknown> = isRecord(routes) ? (routes as Record<string, unknown>) : {};

  const match = pickProtectedRule(pathname, rules, routesMap, parentByPageId);
  if (!match) return NextResponse.next();

  const authKind = (match.auth || "password") as "password" | "github";

  if (authKind === "github") {
    const ok = await isContentGithubAuthorized(req);
    if (ok) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/site-admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url, 302);
  }

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
