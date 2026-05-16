import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getProtectedRoutes } from "@/lib/protected-routes";
import { getRoutesManifest, type RouteManifestItem } from "@/lib/routes-manifest";
import {
  buildParentByPageIdMap,
  lookupPageIdForPath,
  pickProtectedRule,
} from "@/lib/routes/strategy";
import { getSiteConfig } from "@/lib/site-config";
import {
  normalizeSitemapAutoExclude,
  shouldAutoExcludeFromSitemap,
  type SitemapAutoExcludeConfig,
} from "@/lib/shared/sitemap-policy";
import { HIERARCHY_TRAVERSAL_LIMIT } from "@/lib/shared/hierarchy";
import { getSyncMeta } from "@/lib/sync-meta";
import { parsePageFile } from "@/lib/pages/meta";
import { parsePostFile } from "@/lib/posts/meta";
import type { ProtectedRoute } from "@/lib/shared/protected-route";
import { canonicalizeRoutePath, compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { parseSitemapExcludeEntries } from "@/lib/shared/sitemap-excludes";
import { listRawHtmlFiles } from "@/lib/server/content-files";

export type SitemapNode = {
  routePath: string;
  title: string;
  parentRoutePath: string;
};

export type SitemapTreeRow = {
  routePath: string;
  title: string;
  parentRoutePath: string;
  depth: number;
};

export type SitemapSnapshot = {
  nodes: Map<string, SitemapNode>;
  routeMtimeMs: Map<string, number>;
  routeTitles: Map<string, string>;
  fallbackLastmod: string | null;
};

type SitemapExclusionContext = {
  routesMap: Record<string, unknown>;
  parentByPageId: Record<string, string>;
  protectedRules: ProtectedRoute[];
  manualPathPrefixes: string[];
  manualPageIds: Set<string>;
  autoExclude: SitemapAutoExcludeConfig;
};

const EXCLUDED_EXACT = new Set<string>(["/auth", "/site-admin", "/blog/list", "/list"]);
const EXCLUDED_PREFIXES = ["/_next", "/api/", "/site-admin/", "/auth/", "/blog/list/", "/list/"];
const EXTRA_ROUTES = ["/blog", "/calendar", "/sitemap"];

type ContentRoute = {
  routePath: string;
  title: string;
  mtimeMs: number;
};

type RouteSources = {
  routeMtimeMs: Map<string, number>;
  routeTitles: Map<string, string>;
};

function routePathFromRawRelPath(relPath: string): string {
  if (relPath === "index") return "/";
  return normalizeRoutePath(`/${String(relPath || "").replace(/^\/+/, "")}`) || "/";
}

function isPublicSitemapRoute(routePath: string): boolean {
  const p = normalizeRoutePath(routePath || "/") || "/";
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

function getContentRoots(dirName: "pages" | "posts"): string[] {
  const cwd = process.cwd();
  const dirs = [
    path.join(cwd, "content", dirName),
    path.join(cwd, "server-functions", "default", "content", dirName),
    path.join(cwd, ".open-next", "server-functions", "default", "content", dirName),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

function listMdxFilesSync(rootDir: string, recursive: boolean): string[] {
  const out: string[] = [];
  const stack: Array<{ dir: string; prefix: string }> = [{ dir: rootDir, prefix: "" }];

  while (stack.length) {
    const { dir, prefix } = stack.pop()!;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (recursive) stack.push({ dir: abs, prefix: rel });
        continue;
      }
      if (ent.isFile() && /\.mdx?$/.test(ent.name)) out.push(rel);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function readMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function collectPageRoutes(): ContentRoute[] {
  const out = new Map<string, ContentRoute>();
  for (const root of getContentRoots("pages")) {
    for (const rel of listMdxFilesSync(root, true)) {
      const slug = rel.replace(/\.mdx?$/, "");
      if (!slug) continue;
      const filePath = path.join(root, rel);
      let source = "";
      try {
        source = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      try {
        const { entry } = parsePageFile(slug, source);
        if (entry.draft) continue;
        const routePath = canonicalizeRoutePath(`/${slug}`);
        if (!routePath || out.has(routePath)) continue;
        out.set(routePath, {
          routePath,
          title: entry.title,
          mtimeMs: readMtimeMs(filePath),
        });
      } catch {
        // Skip malformed drafts/content rather than breaking sitemap generation.
      }
    }
  }
  return Array.from(out.values());
}

function collectPostRoutes(): ContentRoute[] {
  const out = new Map<string, ContentRoute>();
  for (const root of getContentRoots("posts")) {
    for (const rel of listMdxFilesSync(root, false)) {
      const slug = rel.replace(/\.mdx?$/, "");
      if (!slug) continue;
      const filePath = path.join(root, rel);
      let source = "";
      try {
        source = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      try {
        const { entry } = parsePostFile(slug, source);
        if (entry.draft) continue;
        const routePath = canonicalizeRoutePath(`/blog/${slug}`);
        if (!routePath || out.has(routePath)) continue;
        out.set(routePath, {
          routePath,
          title: entry.title,
          mtimeMs: readMtimeMs(filePath),
        });
      } catch {
        // Skip malformed drafts/content rather than breaking sitemap generation.
      }
    }
  }
  return Array.from(out.values());
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

export function compareRoutePath(a: string, b: string): number {
  if (a === "/" && b !== "/") return -1;
  if (b === "/" && a !== "/") return 1;
  return a.localeCompare(b);
}

function normalizeIsoTimestamp(value: string): string | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function resolveFallbackLastmod(): string | null {
  const syncedAt = getSyncMeta()?.syncedAt;
  if (!syncedAt) return null;
  return normalizeIsoTimestamp(syncedAt);
}

export function resolveLastmod(mtimeMs: number | undefined, fallbackLastmod: string | null): string | null {
  if (typeof mtimeMs === "number" && Number.isFinite(mtimeMs) && mtimeMs > 0) {
    return new Date(mtimeMs).toISOString();
  }
  return fallbackLastmod;
}

export function latestLastmod(values: Array<string | null>): string | null {
  let latest: string | null = null;
  let latestMs = -1;
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeIsoTimestamp(value);
    if (!normalized) continue;
    const ms = Date.parse(normalized);
    if (ms > latestMs) {
      latestMs = ms;
      latest = normalized;
    }
  }
  return latest;
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
    autoExclude: normalizeSitemapAutoExclude(cfg.content?.sitemapAutoExclude),
  };
}

function isPageDescendantOfAny(
  pageId: string,
  ancestors: Set<string>,
  parentByPageId: Record<string, string>,
): boolean {
  let cur = compactId(pageId);
  let guard = 0;
  while (cur && guard++ < HIERARCHY_TRAVERSAL_LIMIT) {
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
  if (shouldAutoExcludeFromSitemap(routePath, ctx.autoExclude)) return true;
  return false;
}

function collectRouteSources(ctx: SitemapExclusionContext): RouteSources {
  const routeMtimeMs = new Map<string, number>();
  const routeTitles = new Map<string, string>();
  const tryAdd = (rawRoute: string, mtimeMs = 0, title = "") => {
    const canonical = canonicalizeRoutePath(rawRoute);
    if (!canonical) return;
    if (!isPublicSitemapRoute(canonical)) return;
    if (isExcludedFromSitemap(canonical, ctx)) return;
    const prev = routeMtimeMs.get(canonical);
    if (typeof prev === "number") {
      routeMtimeMs.set(canonical, Math.max(prev, mtimeMs));
    } else {
      routeMtimeMs.set(canonical, mtimeMs);
    }
    const cleanTitle = String(title || "").trim();
    if (cleanTitle && !routeTitles.has(canonical)) routeTitles.set(canonical, cleanTitle);
  };

  for (const file of listRawHtmlFiles()) {
    const routePath = routePathFromRawRelPath(file.relPath);
    tryAdd(routePath, file.mtimeMs);
  }
  for (const route of collectPageRoutes()) tryAdd(route.routePath, route.mtimeMs, route.title);
  for (const route of collectPostRoutes()) tryAdd(route.routePath, route.mtimeMs, route.title);
  for (const extraRoute of EXTRA_ROUTES) tryAdd(extraRoute);
  tryAdd("/blog");
  tryAdd("/");
  return { routeMtimeMs, routeTitles };
}

export function collectSitemapSnapshot(): SitemapSnapshot {
  const manifest = getRoutesManifest();
  const exclusionCtx = createSitemapExclusionContext(manifest);
  const { routeMtimeMs, routeTitles } = collectRouteSources(exclusionCtx);
  const routes = new Set(routeMtimeMs.keys());
  const manifestByRoute = pickManifestByCanonicalRoute(manifest);
  const nodes = new Map<string, SitemapNode>();

  const sortedRoutes = Array.from(routes).sort(compareRoutePath);
  for (const routePath of sortedRoutes) {
    const matched = manifestByRoute.get(routePath);
    const title =
      routePath === "/"
        ? "Home"
        : (matched?.title?.trim() || routeTitles.get(routePath) || displayTitleFromRoute(routePath));
    const parentRoutePath = resolveParentRoutePath(
      routePath,
      matched?.parentRoutePath || "",
      routes,
    );
    nodes.set(routePath, { routePath, title, parentRoutePath });
  }

  return {
    nodes,
    routeMtimeMs,
    routeTitles,
    fallbackLastmod: resolveFallbackLastmod(),
  };
}

export function buildOrderedSitemapRows(nodes: Map<string, SitemapNode>): SitemapTreeRow[] {
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

  const ordered: SitemapTreeRow[] = [];
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
