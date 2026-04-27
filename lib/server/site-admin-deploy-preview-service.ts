import "server-only";

import deployedComponentSources from "@/content/generated/component-sources.json";
import { COMPONENT_NAMES, readComponent } from "@/lib/components/store";
import { loadComponentUsageMap } from "@/lib/components/usage-server";
import { getProtectedRoutes } from "@/lib/protected-routes";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSiteConfig } from "@/lib/site-config";
import { loadSiteAdminRouteData } from "@/lib/server/site-admin-routes-service";
import type {
  SiteAdminDeployPreviewComponentChange,
  SiteAdminDeployPreviewPayload,
} from "@/lib/site-admin/api-types";
import { getSiteComponentDefinition } from "@/lib/site-admin/component-registry";
import {
  buildDeployPreviewDiff,
  type DeployPreviewProtectedEntry,
  type DeployPreviewRouteEntry,
} from "@/lib/site-admin/deploy-preview-model";
import {
  normalizeProtectedAccessMode,
  type ProtectedAccessMode,
} from "@/lib/shared/access";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";

function normalizePublicRoutePath(value: string): string {
  return normalizeRoutePath(value) || "";
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

function liveOverrideRecord(rows: Array<{ pageId: string; routePath: string }>): Record<string, string> {
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

function buildLiveRoutesFromOverrides(input: {
  currentRoutes: DeployPreviewRouteEntry[];
  liveOverrides: Record<string, string>;
}): DeployPreviewRouteEntry[] {
  const byPageId = new Map<string, DeployPreviewRouteEntry>();
  for (const route of input.currentRoutes) byPageId.set(route.pageId, route);

  const out: DeployPreviewRouteEntry[] = [];
  for (const route of input.currentRoutes) {
    out.push({
      pageId: route.pageId,
      title: route.title,
      routePath: input.liveOverrides[route.pageId] || route.routePath,
    });
  }

  // Keep override-only ids visible in preview (for example stale/orphan ids);
  // they will surface in redirect/protected diff and preflight cards.
  for (const [pageId, routePath] of Object.entries(input.liveOverrides)) {
    if (byPageId.has(pageId)) continue;
    out.push({
      pageId,
      title: "Untitled",
      routePath,
    });
  }
  return normalizeRouteEntries(out);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function deployedComponentSha(name: string): { sha: string; contentSha: string } {
  const root = asRecord(deployedComponentSources);
  const components = asRecord(root.components);
  const item = asRecord(components[name]);
  return {
    sha: asString(item.sha),
    contentSha: asString(item.contentSha),
  };
}

async function liveComponentChanges(): Promise<SiteAdminDeployPreviewComponentChange[]> {
  const [usageMap, componentDetails] = await Promise.all([
    loadComponentUsageMap(),
    Promise.all(COMPONENT_NAMES.map((name) => readComponent(name))),
  ]);
  const out: SiteAdminDeployPreviewComponentChange[] = [];
  for (let index = 0; index < COMPONENT_NAMES.length; index += 1) {
    const name = COMPONENT_NAMES[index];
    const detail = componentDetails[index];
    if (!detail) continue;
    const deployed = deployedComponentSha(name);
    if (detail.version === deployed.sha || detail.version === deployed.contentSha) {
      continue;
    }
    const definition = getSiteComponentDefinition(name);
    const affectedRoutes = (usageMap[name] ?? [])
      .map((usage) => usage.routePath || usage.sourcePath)
      .filter(Boolean);
    out.push({
      name,
      label: definition.label,
      sourcePath: definition.sourcePath,
      embedTag: definition.embedTag,
      affectedRoutes: Array.from(new Set(affectedRoutes)).sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  }
  return out;
}

export async function buildSiteAdminDeployPreviewPayload(): Promise<
  Omit<SiteAdminDeployPreviewPayload, "ok">
> {
  const currentRoutes = currentRouteEntries();
  const currentOverrides = currentOverrideRecord();
  const currentProtected = currentProtectedEntries();

  const routeData = await loadSiteAdminRouteData();
  const liveOverrides = liveOverrideRecord(routeData.overrides);
  const liveRoutes = buildLiveRoutesFromOverrides({
    currentRoutes,
    liveOverrides,
  });
  const liveProtected = liveProtectedEntries(routeData.protectedRoutes);
  const componentChanges = await liveComponentChanges();

  const diff = buildDeployPreviewDiff({
    currentRoutes,
    liveRoutes,
    currentOverrides,
    liveOverrides,
    currentProtected,
    liveProtected,
    componentChanges,
  });

  return {
    generatedAt: new Date().toISOString(),
    ...diff,
  };
}
