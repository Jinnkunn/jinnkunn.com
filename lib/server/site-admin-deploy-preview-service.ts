import "server-only";

import { parseNotionPageMeta } from "@/lib/notion/adapters";
import { notionRequest } from "@/lib/notion/api";
import { getProtectedRoutes } from "@/lib/protected-routes";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { canonicalizePublicRoute } from "@/lib/routes/strategy";
import { getNotionSyncCacheDir } from "@/lib/server/content-files";
import { loadSiteAdminConfigData } from "@/lib/server/site-admin-config-service";
import { loadSiteAdminRouteData } from "@/lib/server/site-admin-routes-service";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminDeployPreviewPayload } from "@/lib/site-admin/api-types";
import {
  normalizeProtectedAccessMode,
  type ProtectedAccessMode,
} from "@/lib/shared/access";
import {
  buildDeployPreviewDiff,
  type DeployPreviewProtectedEntry,
  type DeployPreviewRouteEntry,
} from "@/lib/site-admin/deploy-preview-model";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { getSyncMeta } from "@/lib/sync-meta";

type RouteNode = {
  kind?: string;
  id?: string;
  title?: string;
  children?: RouteNode[];
  parentId?: string;
  routePath?: string;
  routeSegments?: string[];
};

type BuildPageTreeFn = (
  parentPageId: string,
  opts?: { seenDatabases?: Set<string> },
) => Promise<RouteNode[]>;

type AssignRoutesFn = (
  nodes: RouteNode[],
  opts: { homePageId: string; routeOverrides?: Map<string, string> },
  parentSegments?: string[],
) => void;

type FlattenPagesFn = (nodes: RouteNode[]) => RouteNode[];
type PickHomePageIdFn = (
  nodes: RouteNode[],
  cfg?: { content?: { homePageId?: string } } | null,
) => string;

function normalizePublicRoutePath(value: string): string {
  const normalized = normalizeRoutePath(value);
  if (!normalized) return "";
  return normalizeRoutePath(canonicalizePublicRoute(normalized)) || "";
}

function normalizeRouteEntries(items: DeployPreviewRouteEntry[]): DeployPreviewRouteEntry[] {
  const out: DeployPreviewRouteEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const pageId = compactId(item.pageId);
    const routePath = normalizePublicRoutePath(item.routePath);
    const title = String(item.title || "").trim() || "Untitled";
    if (!pageId || !routePath) continue;
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    out.push({ pageId, routePath, title });
  }
  return out;
}

function currentRouteEntries(): DeployPreviewRouteEntry[] {
  const out: DeployPreviewRouteEntry[] = [];
  for (const item of getRoutesManifest()) {
    const pageId = compactId(item.id);
    const routePath = normalizePublicRoutePath(item.routePath);
    const title = String(item.title || "").trim() || "Untitled";
    if (!pageId || !routePath) continue;
    out.push({ pageId, routePath, title });
  }
  return normalizeRouteEntries(out);
}

function currentOverrideRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = getSiteConfig().content?.routeOverrides || {};
  for (const [rawPageId, rawPath] of Object.entries(raw)) {
    const pageId = compactId(rawPageId);
    const routePath = normalizePublicRoutePath(String(rawPath || ""));
    if (!pageId || !routePath) continue;
    out[pageId] = routePath;
  }
  return out;
}

function liveOverrideRecord(
  rows: Array<{ pageId: string; routePath: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const pageId = compactId(row.pageId);
    const routePath = normalizePublicRoutePath(row.routePath);
    if (!pageId || !routePath) continue;
    out[pageId] = routePath;
  }
  return out;
}

function normalizeProtectedEntry(input: {
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  auth?: ProtectedAccessMode;
}): DeployPreviewProtectedEntry | null {
  const path = normalizePublicRoutePath(input.path);
  if (!path) return null;
  const pageId = compactId(input.pageId || "") || `path:${path}`;
  const mode: "exact" | "prefix" = input.mode === "prefix" ? "prefix" : "exact";
  const auth = normalizeProtectedAccessMode(input.auth, "password");
  return { pageId, path, mode, auth };
}

function currentProtectedEntries(): DeployPreviewProtectedEntry[] {
  const out: DeployPreviewProtectedEntry[] = [];
  for (const row of getProtectedRoutes()) {
    const normalized = normalizeProtectedEntry({
      pageId: row.pageId,
      path: row.path,
      mode: row.mode,
      auth: row.auth,
    });
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

function liveProtectedEntries(
  rows: Array<{ pageId: string; path: string; mode: "exact" | "prefix"; auth: ProtectedAccessMode }>,
): DeployPreviewProtectedEntry[] {
  const out: DeployPreviewProtectedEntry[] = [];
  for (const row of rows) {
    const normalized = normalizeProtectedEntry(row);
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

async function fetchPageTitle(pageId32: string): Promise<string> {
  const data = await notionRequest<unknown>(`pages/${pageId32}`, { maxRetries: 2 });
  const parsed = parseNotionPageMeta(data, {
    fallbackId: pageId32,
    fallbackTitle: "Untitled",
  });
  return parsed?.title || "Untitled";
}

async function loadLiveRouteEntries(input: {
  rootPageId: string;
  homePageId: string;
  routeOverrides: Record<string, string>;
}): Promise<DeployPreviewRouteEntry[]> {
  const pageTreeMod = await import("../../scripts/notion-sync/page-tree.mjs");
  const routeModelMod = await import("../../scripts/notion-sync/route-model.mjs");

  const createPageTreeBuilder = pageTreeMod.createPageTreeBuilder as (opts: {
    cacheDir: string;
    cacheEnabled: boolean;
    cacheForce: boolean;
  }) => BuildPageTreeFn;
  const assignRoutes = routeModelMod.assignRoutes as AssignRoutesFn;
  const flattenPages = routeModelMod.flattenPages as FlattenPagesFn;
  const pickHomePageId = routeModelMod.pickHomePageId as PickHomePageIdFn;

  const buildPageTree = createPageTreeBuilder({
    cacheDir: getNotionSyncCacheDir(),
    cacheEnabled: true,
    cacheForce: false,
  });
  const seenDatabases = new Set<string>();
  const routeOverrides = new Map<string, string>();
  for (const [rawPageId, rawPath] of Object.entries(input.routeOverrides)) {
    const pageId = compactId(rawPageId);
    const routePath = normalizePublicRoutePath(rawPath);
    if (!pageId || !routePath) continue;
    routeOverrides.set(pageId, routePath);
  }

  let allPages: RouteNode[] = [];
  if (input.homePageId === input.rootPageId) {
    const rootTitle = await fetchPageTitle(input.rootPageId);
    const rootNode: RouteNode = {
      kind: "page",
      id: input.rootPageId,
      title: rootTitle,
      children: await buildPageTree(input.rootPageId, { seenDatabases }),
      parentId: "",
      routePath: "/",
      routeSegments: [],
    };
    assignRoutes(rootNode.children || [], { homePageId: input.homePageId, routeOverrides });
    allPages = [rootNode, ...flattenPages(rootNode.children || [])];
  } else {
    const top = await buildPageTree(input.rootPageId, { seenDatabases });
    if (!top.length) {
      throw new Error("No child pages found under current content root");
    }
    const topHomePageId = pickHomePageId(top, { content: { homePageId: input.homePageId } });
    assignRoutes(top, { homePageId: topHomePageId, routeOverrides });
    allPages = flattenPages(top);
  }

  const entries: DeployPreviewRouteEntry[] = [];
  for (const node of allPages) {
    const pageId = compactId(node.id || "");
    const routePath = normalizePublicRoutePath(String(node.routePath || ""));
    const title = String(node.title || "").trim() || "Untitled";
    if (!pageId || !routePath) continue;
    entries.push({ pageId, routePath, title });
  }
  return normalizeRouteEntries(entries);
}

function resolveRootPageId(liveRoot: string): string {
  return (
    compactId(liveRoot) ||
    compactId(getSiteConfig().content?.rootPageId || "") ||
    compactId(getSyncMeta()?.rootPageId || "") ||
    compactId(process.env.NOTION_SITE_ADMIN_PAGE_ID || "")
  );
}

function resolveHomePageId(liveHome: string, rootPageId: string): string {
  return (
    compactId(liveHome) ||
    compactId(getSiteConfig().content?.homePageId || "") ||
    compactId(getSyncMeta()?.homePageId || "") ||
    rootPageId
  );
}

export async function buildSiteAdminDeployPreviewPayload(): Promise<
  Omit<SiteAdminDeployPreviewPayload, "ok">
> {
  const token = String(process.env.NOTION_TOKEN || "").trim();
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const currentRoutes = currentRouteEntries();
  const currentOverrides = currentOverrideRecord();
  const currentProtected = currentProtectedEntries();

  const [{ settings }, routeData] = await Promise.all([
    loadSiteAdminConfigData(),
    loadSiteAdminRouteData(),
  ]);

  const rootPageId = resolveRootPageId(settings?.rootPageId || "");
  if (!rootPageId) throw new Error("Missing content root page id");
  const homePageId = resolveHomePageId(settings?.homePageId || "", rootPageId);

  const liveOverrides = liveOverrideRecord(routeData.overrides);
  const liveRoutes = await loadLiveRouteEntries({
    rootPageId,
    homePageId,
    routeOverrides: liveOverrides,
  });
  const liveProtected = liveProtectedEntries(routeData.protectedRoutes);

  const diff = buildDeployPreviewDiff({
    currentRoutes,
    liveRoutes,
    currentOverrides,
    liveOverrides,
    currentProtected,
    liveProtected,
  });

  return {
    generatedAt: new Date().toISOString(),
    ...diff,
  };
}
