import "server-only";

import { getProtectedRoutes } from "@/lib/protected-routes";
import { getRoutesManifest, type RouteManifestItem } from "@/lib/routes-manifest";
import {
  buildParentByPageIdMap,
  canonicalizePublicRoute,
  lookupPageIdForPath,
  pickProtectedRule,
} from "@/lib/routes/strategy";
import { getSiteConfig } from "@/lib/site-config";
import type { ProtectedRoute } from "@/lib/shared/protected-route";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { parseSitemapExcludeEntries } from "@/lib/shared/sitemap-excludes";
import { listRawHtmlRelPaths } from "@/lib/server/content-files";

export type SitemapRoute = {
  routePath: string;
  title: string;
  parentRoutePath: string;
  depth: number;
};

type SitemapNode = {
  routePath: string;
  title: string;
  parentRoutePath: string;
};

type SitemapExclusionContext = {
  routesMap: Record<string, unknown>;
  parentByPageId: Record<string, string>;
  protectedRules: ProtectedRoute[];
  manualPathPrefixes: string[];
  manualPageIds: Set<string>;
};

const EXCLUDED_EXACT = new Set<string>(["/auth", "/site-admin", "/blog/list", "/list"]);
const EXCLUDED_PREFIXES = ["/_next", "/api/", "/site-admin/", "/auth/", "/blog/list/", "/list/"];
const EXTRA_ROUTES = ["/blog", "/sitemap"];

function canonicalizeRoutePath(routePath: string): string {
  const raw = String(routePath || "").trim();
  if (!raw) return "";
  return normalizeRoutePath(canonicalizePublicRoute(raw)) || "/";
}

function routePathFromRawRelPath(relPath: string): string {
  if (relPath === "index") return "/";
  return normalizeRoutePath(`/${String(relPath || "").replace(/^\/+/, "")}`) || "/";
}

function isPublicSitemapRoute(routePath: string): boolean {
  const p = normalizeRoutePath(routePath || "/") || "/";
  // Exclude bare Notion-id fallback URLs; keep only canonical paths.
  if (/^\/[0-9a-f]{32}$/i.test(p)) return false;
  if (EXCLUDED_EXACT.has(p)) return false;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (p.startsWith(prefix)) return false;
  }
  return true;
}

function displayTitleFromRoute(routePath: string): string {
  if (routePath === "/") return "Home";
  if (routePath === "/sitemap") return "Sitemap";

  const seg = routePath.split("/").filter(Boolean).at(-1) || "";
  const decoded = decodeURIComponent(seg);
  return decoded.replace(/[-_]+/g, " ").trim() || decoded || "Untitled";
}

function candidateScore(item: RouteManifestItem, canonicalRoute: string): number {
  let score = 0;
  const raw = normalizeRoutePath(item.routePath || "/") || "/";
  if (raw === canonicalRoute) score += 20;
  if (item.kind === "page") score += 10;
  if (item.kind === "database") score += 5;
  if (item.title.trim()) score += 1;
  return score;
}

function pickManifestByCanonicalRoute(items: RouteManifestItem[]): Map<string, RouteManifestItem> {
  const out = new Map<string, RouteManifestItem>();
  for (const item of items) {
    const canonicalRoute = canonicalizeRoutePath(item.routePath);
    if (!canonicalRoute) continue;
    if (!isPublicSitemapRoute(canonicalRoute)) continue;

    const prev = out.get(canonicalRoute);
    if (!prev || candidateScore(item, canonicalRoute) > candidateScore(prev, canonicalRoute)) {
      out.set(canonicalRoute, item);
    }
  }
  return out;
}

function resolveParentRoutePath(
  routePath: string,
  hintedParentRoute: string,
  allRoutes: Set<string>,
): string {
  if (routePath === "/") return "";

  const hinted = canonicalizeRoutePath(hintedParentRoute);
  if (hinted && hinted !== routePath && allRoutes.has(hinted)) return hinted;

  const segs = routePath.split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 1; i--) {
    const prefix = `/${segs.slice(0, i).join("/")}`;
    if (allRoutes.has(prefix)) return prefix;
  }

  return allRoutes.has("/") ? "/" : "";
}

function compareRoutePath(a: string, b: string): number {
  if (a === "/" && b !== "/") return -1;
  if (b === "/" && a !== "/") return 1;
  return a.localeCompare(b);
}

function buildRoutesMap(items: RouteManifestItem[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const it of items) {
    const p = normalizeRoutePath(it.routePath);
    if (!p) continue;
    out[p] = String(it.id || "");
  }
  return out;
}

function normalizeManualExcludePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = canonicalizeRoutePath(raw);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  // Prefix checks should prefer longer matches first.
  out.sort((a, b) => b.length - a.length);
  return out;
}

function createSitemapExclusionContext(items: RouteManifestItem[]): SitemapExclusionContext {
  const cfg = getSiteConfig();
  const rawManual = parseSitemapExcludeEntries(cfg.content?.sitemapExcludes || []);
  const manualPathPrefixes: string[] = [];
  const manualPageIds = new Set<string>();

  for (const entry of rawManual) {
    const id = compactId(entry);
    if (id) {
      manualPageIds.add(id);
      continue;
    }
    manualPathPrefixes.push(entry);
  }

  return {
    routesMap: buildRoutesMap(items),
    parentByPageId: buildParentByPageIdMap(items),
    protectedRules: getProtectedRoutes(),
    manualPathPrefixes: normalizeManualExcludePaths(manualPathPrefixes),
    manualPageIds,
  };
}

function isPageDescendantOfAny(
  pageId: string,
  ancestors: Set<string>,
  parentByPageId: Record<string, string>,
): boolean {
  let cur = compactId(pageId);
  let guard = 0;
  while (cur && guard++ < 300) {
    if (ancestors.has(cur)) return true;
    cur = compactId(parentByPageId[cur] || "");
  }
  return false;
}

function isManuallyExcluded(routePath: string, ctx: SitemapExclusionContext): boolean {
  for (const prefix of ctx.manualPathPrefixes) {
    if (routePath === prefix || routePath.startsWith(`${prefix}/`)) return true;
  }

  if (!ctx.manualPageIds.size) return false;
  const pageId = lookupPageIdForPath(routePath, ctx.routesMap);
  if (!pageId) return false;
  return isPageDescendantOfAny(pageId, ctx.manualPageIds, ctx.parentByPageId);
}

function isProtectedExcluded(routePath: string, ctx: SitemapExclusionContext): boolean {
  if (!ctx.protectedRules.length) return false;
  return Boolean(pickProtectedRule(routePath, ctx.protectedRules, ctx.routesMap, ctx.parentByPageId));
}

function isExcludedFromSitemap(routePath: string, ctx: SitemapExclusionContext): boolean {
  if (isProtectedExcluded(routePath, ctx)) return true;
  if (isManuallyExcluded(routePath, ctx)) return true;
  return false;
}

function collectCanonicalRoutes(ctx: SitemapExclusionContext): Set<string> {
  const out = new Set<string>();
  const tryAdd = (rawRoute: string) => {
    const canonical = canonicalizeRoutePath(rawRoute);
    if (!canonical) return;
    if (!isPublicSitemapRoute(canonical)) return;
    if (isExcludedFromSitemap(canonical, ctx)) return;
    out.add(canonical);
  };

  for (const rel of listRawHtmlRelPaths()) {
    const routePath = routePathFromRawRelPath(rel);
    tryAdd(routePath);
  }

  for (const extraRoute of EXTRA_ROUTES) {
    tryAdd(extraRoute);
  }

  // Canonical /blog should always be present.
  tryAdd("/blog");
  // A hierarchy without root is hard to understand for humans.
  tryAdd("/");
  return out;
}

function collectSitemapNodes(): Map<string, SitemapNode> {
  const manifest = getRoutesManifest();
  const exclusionCtx = createSitemapExclusionContext(manifest);
  const routes = collectCanonicalRoutes(exclusionCtx);
  const manifestByRoute = pickManifestByCanonicalRoute(manifest);
  const nodes = new Map<string, SitemapNode>();

  const sortedRoutes = Array.from(routes).sort(compareRoutePath);
  for (const routePath of sortedRoutes) {
    const matched = manifestByRoute.get(routePath);
    const title = routePath === "/"
      ? "Home"
      : (matched?.title?.trim() || displayTitleFromRoute(routePath));
    const parentRoutePath = resolveParentRoutePath(
      routePath,
      matched?.parentRoutePath || "",
      routes,
    );
    nodes.set(routePath, { routePath, title, parentRoutePath });
  }
  return nodes;
}

export function getHierarchicalSitemapRoutes(): SitemapRoute[] {
  const nodes = collectSitemapNodes();
  const childrenByParent = new Map<string, string[]>();

  for (const node of nodes.values()) {
    const parent = node.parentRoutePath || "";
    const arr = childrenByParent.get(parent) || [];
    arr.push(node.routePath);
    childrenByParent.set(parent, arr);
  }

  for (const [parent, childRoutes] of childrenByParent.entries()) {
    childRoutes.sort(compareRoutePath);
    childrenByParent.set(parent, childRoutes);
  }

  const ordered: SitemapRoute[] = [];
  const seen = new Set<string>();

  const walk = (routePath: string, depth: number) => {
    if (!routePath || seen.has(routePath)) return;
    const node = nodes.get(routePath);
    if (!node) return;
    seen.add(routePath);
    ordered.push({
      routePath: node.routePath,
      title: node.title,
      parentRoutePath: node.parentRoutePath,
      depth,
    });
    const children = childrenByParent.get(routePath) || [];
    for (const child of children) walk(child, depth + 1);
  };

  for (const root of childrenByParent.get("") || []) walk(root, 0);
  for (const routePath of Array.from(nodes.keys()).sort(compareRoutePath)) {
    if (!seen.has(routePath)) walk(routePath, 0);
  }

  return ordered;
}

export function getHierarchicalSitemapRoutePaths(): string[] {
  return getHierarchicalSitemapRoutes().map((row) => row.routePath);
}
