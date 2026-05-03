import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import filesystemProtectedRoutesData from "@/content/filesystem/protected-routes.json";
import protectedRoutesData from "@/content/generated/protected-routes.json";
import routesData from "@/content/generated/routes.json";
import routesManifestData from "@/content/generated/routes-manifest.json";
import { buildParentByPageIdMap, pickProtectedRule } from "@/lib/routes/strategy";

type ProtectedRoute = {
  id: string;
  auth?: "password" | "github";
  key?: "pageId" | "path";
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

const protectedRoutes: ProtectedRoute[] = Array.isArray(protectedRoutesData)
  ? (protectedRoutesData as ProtectedRoute[])
  : [];
const filesystemProtectedRoutes: ProtectedRoute[] = Array.isArray(filesystemProtectedRoutesData)
  ? (filesystemProtectedRoutesData as ProtectedRoute[])
  : [];
const activeProtectedRoutes =
  filesystemProtectedRoutes.length > 0 ? filesystemProtectedRoutes : protectedRoutes;

const routesMap: Record<string, unknown> =
  routesData && typeof routesData === "object" && !Array.isArray(routesData)
    ? (routesData as Record<string, unknown>)
    : {};

const pageIdToRouteMap: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [route, pageId] of Object.entries(routesMap)) {
    if (typeof pageId !== "string") continue;
    const key = pageId.replace(/-/g, "").toLowerCase();
    if (!key) continue;
    if (!out[key] || route.length < out[key]!.length) out[key] = route;
  }
  return out;
})();

const parentByPageIdMap: Record<string, string> = buildParentByPageIdMap(routesManifestData);

function normalizePathname(pathname: string): string {
  const raw = String(pathname || "").trim();
  if (!raw) return "/";
  if (raw === "/") return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function canonicalizePublicRoute(pathname: string): string {
  if (pathname === "/blog/list") return "/blog";
  if (pathname.startsWith("/blog/list/")) {
    const slug = pathname.slice("/blog/list/".length).replace(/^\/+/, "");
    return slug ? `/blog/${slug}` : "/blog";
  }
  return pathname;
}

function normalizePageId(pathname: string): string | null {
  const hit = /^\/([0-9a-f]{32})$/i.exec(pathname);
  if (!hit?.[1]) return null;
  return hit[1].toLowerCase();
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

async function isSiteAdminAuthorized(req: NextRequest): Promise<boolean> {
  const mod = await import("@/lib/site-admin-auth");
  return mod.isSiteAdminAuthorized(req);
}

async function isContentGithubAuthorized(req: NextRequest): Promise<boolean> {
  const mod = await import("@/lib/content-auth");
  return mod.isContentGithubAuthorized(req);
}

function resolveNotionIdPathRedirect(pathname: string): string | null {
  const pageId = normalizePageId(pathname);
  if (!pageId) return null;
  return pageIdToRouteMap[pageId] ?? null;
}

// Staging-wide gate: when `STAGING_GATE=1` (see wrangler.toml
// [env.staging.vars]), every non-bypass route requires a signed-in site
// admin. Prod leaves the flag unset so it stays public.
const STAGING_GATE = process.env.STAGING_GATE === "1";

export async function middleware(req: NextRequest) {
  const pathname = normalizePathname(req.nextUrl.pathname || "/");
  if (isBypassedPath(pathname)) return NextResponse.next();

  // The browser /site-admin pages were removed in 2026-05; the Tauri
  // workspace app is the only admin UI now and its authenticated calls
  // hit `/api/site-admin/*` directly (auth handled inside each route via
  // withSiteAdminContext, not the edge middleware).

  // On staging: anything that reaches this point (not bypassed) is a
  // public page we still want to hide. Gate it behind the same NextAuth
  // cookie so
  // one GitHub sign-in covers both the marketing pages and the admin.
  if (STAGING_GATE) {
    const ok = await isSiteAdminAuthorized(req);
    if (!ok) {
      // The dedicated /site-admin/login page was removed when the
      // browser-based admin UI was retired. Send unauthenticated visitors
      // to the NextAuth-provided /api/auth/signin flow, with a callback
      // back to the original page after sign-in.
      const url = req.nextUrl.clone();
      url.pathname = "/api/auth/signin";
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url, 302);
    }
  }

  {
    const canon = canonicalizePublicRoute(pathname);
    if (canon && canon !== pathname) {
      const url = req.nextUrl.clone();
      url.pathname = canon;
      return NextResponse.redirect(url, 308);
    }
  }

  {
    const target = resolveNotionIdPathRedirect(pathname);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url, 308);
    }
  }

  if (activeProtectedRoutes.length === 0) return NextResponse.next();

  const match = pickProtectedRule(pathname, activeProtectedRoutes, routesMap, parentByPageIdMap);
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
  matcher: [
    // Skip Next internals, static asset directories, and common well-known
    // paths at the matcher layer so middleware only runs for real page
    // navigations / API requests that might need auth/redirect work.
    "/((?!_next/|assets/|styles/|fonts/|web_image/|notion-assets/|cdn-cgi/|\\.well-known/|favicon\\.ico|apple-touch-icon|robots\\.txt|sitemap.*\\.xml|site\\.webmanifest|manifest\\.json|browserconfig\\.xml|safari-pinned-tab\\.svg).*)",
  ],
};
