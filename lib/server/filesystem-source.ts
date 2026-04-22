import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { SiteConfig } from "@/lib/site-config";
import { normalizeSiteConfigInput } from "@/lib/site-config";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
} from "@/lib/site-admin/api-types";
import { DEFAULT_SITE_CONFIG } from "@/lib/shared/default-site-config";
import { parseGithubUserCsv } from "@/lib/shared/github-users";
import { normalizeSeoPageOverrides } from "@/lib/shared/seo-page-overrides";
import { parseSitemapExcludeEntries } from "@/lib/shared/sitemap-excludes";
import { parseSitemapSectionList, type SitemapSection } from "@/lib/shared/sitemap-policy";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import type { ProtectedAccessMode } from "@/lib/shared/access";
import { parseDepthNumber } from "@/lib/shared/depth";
import type { ProtectedRoute } from "@/lib/shared/protected-route";

export type SourceNavItem = {
  id: string;
  label: string;
  href: string;
  order: number;
  enabled: boolean;
};

export type SourceSiteConfig = Omit<SiteConfig, "nav"> & {
  nav: {
    top: SourceNavItem[];
    more: SourceNavItem[];
  };
};

export type SourceRouteManifestItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  parentId: string;
  parentRoutePath: string;
};

const SETTINGS_ROW_ID = "filesystem-site-settings";

function sourceRoot(rootDir = process.cwd()) {
  return path.join(rootDir, "content", "filesystem");
}

export function filesystemSiteConfigFile(rootDir = process.cwd()) {
  return path.join(sourceRoot(rootDir), "site-config.json");
}

export function filesystemProtectedRoutesFile(rootDir = process.cwd()) {
  return path.join(sourceRoot(rootDir), "protected-routes.json");
}

export function filesystemRoutesManifestFile(rootDir = process.cwd()) {
  return path.join(sourceRoot(rootDir), "routes-manifest.json");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

function hashText(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createStableNavId(
  group: "top" | "more",
  raw: Record<string, unknown>,
  fallback: { label: string; href: string },
  fallbackOrder: number,
): string {
  const id = String(raw.id ?? "").trim();
  if (id) return id;
  return `fs-nav-${hashText(
    `${group}\n${fallbackOrder}\n${String(raw.label ?? fallback.label ?? "").trim()}\n${String(raw.href ?? fallback.href ?? "").trim()}`,
  )}`;
}

function normalizeSourceNavEntry(
  raw: unknown,
  fallback: { label: string; href: string },
  fallbackOrder: number,
  group: "top" | "more",
): SourceNavItem {
  const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = createStableNavId(group, entry, fallback, fallbackOrder);
  const label = String(entry.label ?? fallback.label ?? "").trim() || fallback.label || "Untitled";
  const href = String(entry.href ?? fallback.href ?? "").trim() || fallback.href || "/";
  const order = parseDepthNumber(entry.order ?? fallbackOrder, { min: 0, max: 500 }) ?? fallbackOrder;
  const enabled = entry.enabled === undefined ? true : entry.enabled !== false;
  return { id, label, href, order, enabled };
}

function normalizeSourceNavGroup(
  input: unknown,
  fallback: Array<{ label: string; href: string }>,
  group: "top" | "more",
): SourceNavItem[] {
  if (!Array.isArray(input) || input.length === 0) {
    return fallback.map((item, index) => normalizeSourceNavEntry(item, item, index, group));
  }
  return input.map((item, index) => {
    const fallbackItem = fallback[index] ?? { label: "", href: "/" };
    return normalizeSourceNavEntry(item, fallbackItem, index, group);
  });
}

function sortNavItems(items: SourceNavItem[]): SourceNavItem[] {
  return [...items]
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.href.localeCompare(b.href);
    })
    .map((item, index) => ({ ...item, order: index }));
}

export function buildRuntimeSiteConfig(sourceConfig: SourceSiteConfig): SiteConfig {
  return {
    ...sourceConfig,
    nav: {
      top: sortNavItems(sourceConfig.nav.top)
        .filter((item) => item.enabled)
        .map(({ label, href }) => ({ label, href })),
      more: sortNavItems(sourceConfig.nav.more)
        .filter((item) => item.enabled)
        .map(({ label, href }) => ({ label, href })),
    },
  };
}

export function normalizeSourceSiteConfig(raw: unknown): SourceSiteConfig {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const runtime = normalizeSiteConfigInput(record);
  const navRaw = record.nav && typeof record.nav === "object" ? (record.nav as Record<string, unknown>) : {};

  return {
    ...runtime,
    nav: {
      top: sortNavItems(normalizeSourceNavGroup(navRaw.top, runtime.nav.top, "top")),
      more: sortNavItems(normalizeSourceNavGroup(navRaw.more, runtime.nav.more, "more")),
    },
  };
}

export function serializeSourceSiteConfig(sourceConfig: SourceSiteConfig): Record<string, unknown> {
  return {
    ...sourceConfig,
    nav: {
      top: sortNavItems(sourceConfig.nav.top).map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        order: item.order,
        enabled: item.enabled,
      })),
      more: sortNavItems(sourceConfig.nav.more).map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        order: item.order,
        enabled: item.enabled,
      })),
    },
  };
}

export async function readFilesystemSourceSiteConfig(): Promise<SourceSiteConfig> {
  const raw = await readJsonFile<Record<string, unknown>>(filesystemSiteConfigFile(), {});
  return normalizeSourceSiteConfig(raw);
}

export async function writeFilesystemSourceSiteConfig(sourceConfig: SourceSiteConfig): Promise<void> {
  await writeJsonAtomic(filesystemSiteConfigFile(), serializeSourceSiteConfig(sourceConfig));
}

export function toSettingsRow(sourceConfig: SourceSiteConfig): SiteSettings {
  return {
    rowId: SETTINGS_ROW_ID,
    siteName: sourceConfig.siteName,
    lang: sourceConfig.lang,
    seoTitle: sourceConfig.seo.title,
    seoDescription: sourceConfig.seo.description,
    favicon: sourceConfig.seo.favicon,
    ogImage: sourceConfig.seo.ogImage || "",
    seoPageOverrides: JSON.stringify(sourceConfig.seo.pageOverrides || {}, null, 2),
    googleAnalyticsId: sourceConfig.integrations?.googleAnalyticsId || "",
    contentGithubUsers: (sourceConfig.security?.contentGithubUsers || []).join(", "),
    sitemapExcludes: (sourceConfig.content?.sitemapExcludes || []).join("\n"),
    sitemapAutoExcludeEnabled: sourceConfig.content?.sitemapAutoExclude?.enabled ?? true,
    sitemapAutoExcludeSections: (sourceConfig.content?.sitemapAutoExclude?.excludeSections || []).join(", "),
    sitemapAutoExcludeDepthPages: String(sourceConfig.content?.sitemapAutoExclude?.maxDepthBySection?.pages ?? ""),
    sitemapAutoExcludeDepthBlog: String(sourceConfig.content?.sitemapAutoExclude?.maxDepthBySection?.blog ?? ""),
    sitemapAutoExcludeDepthPublications: String(
      sourceConfig.content?.sitemapAutoExclude?.maxDepthBySection?.publications ?? "",
    ),
    sitemapAutoExcludeDepthTeaching: String(
      sourceConfig.content?.sitemapAutoExclude?.maxDepthBySection?.teaching ?? "",
    ),
    rootPageId: sourceConfig.content?.rootPageId || "",
    homePageId: sourceConfig.content?.homePageId || "",
  };
}

export function navRowsForGroup(group: "top" | "more", items: SourceNavItem[]): NavItemRow[] {
  return sortNavItems(items).map((item, index) => ({
    rowId: item.id,
    label: item.label,
    href: item.href,
    group,
    order: item.order,
    enabled: item.enabled,
  }));
}

function normalizeProtectedRoute(row: unknown): ProtectedRoute | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const pathValue = normalizeRoutePath(String(value.path || ""));
  if (!pathValue) return null;
  const pageId = compactId(String(value.pageId || ""));
  const authRaw = String(value.auth || "").trim().toLowerCase();
  const auth: ProtectedAccessMode = authRaw === "github" ? "github" : "password";
  const modeRaw = String(value.mode || "").trim().toLowerCase();
  const mode: "exact" | "prefix" = modeRaw === "prefix" ? "prefix" : "exact";
  const token = String(value.token || "").trim();
  if (!token) return null;
  const id = String(value.id || "").trim() || pageId || hashText(`${auth}\n${pathValue}`);
  const keyRaw = String(value.key || "").trim().toLowerCase();
  const key: "pageId" | "path" = keyRaw === "pageid" || pageId ? "pageId" : "path";
  return {
    id,
    path: pathValue,
    mode,
    token,
    auth,
    key,
    pageId: pageId || undefined,
  };
}

export async function readFilesystemProtectedRoutes(): Promise<ProtectedRoute[]> {
  const rows = await readJsonFile<unknown[]>(filesystemProtectedRoutesFile(), []);
  return normalizeProtectedRouteRows(rows);
}

export function normalizeProtectedRouteRows(rows: unknown[]): ProtectedRoute[] {
  return rows.map(normalizeProtectedRoute).filter((row): row is ProtectedRoute => Boolean(row));
}

export async function writeFilesystemProtectedRoutes(routes: ProtectedRoute[]): Promise<void> {
  await writeJsonAtomic(filesystemProtectedRoutesFile(), routes);
}

export function mapSourceConfigToSiteAdminConfigData(sourceConfig: SourceSiteConfig): {
  settings: SiteSettings | null;
  nav: NavItemRow[];
} {
  return {
    settings: toSettingsRow(sourceConfig),
    nav: [
      ...navRowsForGroup("top", sourceConfig.nav.top),
      ...navRowsForGroup("more", sourceConfig.nav.more),
    ],
  };
}

export async function loadFilesystemSiteAdminConfigData(): Promise<{
  settings: SiteSettings | null;
  nav: NavItemRow[];
}> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  return mapSourceConfigToSiteAdminConfigData(sourceConfig);
}

function normalizeDepthStringMap(value: string): number | undefined {
  const normalized = parseDepthNumber(value, { min: 0, max: 20 });
  return normalized === null ? undefined : normalized;
}

export function applySiteSettingsPatchToSourceConfig(
  sourceConfig: SourceSiteConfig,
  patch: Partial<Omit<SiteSettings, "rowId">>,
): SourceSiteConfig {
  const next = structuredClone(sourceConfig);

  if (patch.siteName !== undefined) next.siteName = String(patch.siteName || "").trim();
  if (patch.lang !== undefined) next.lang = String(patch.lang || "").trim() || DEFAULT_SITE_CONFIG.lang;

  if (patch.seoTitle !== undefined) next.seo.title = String(patch.seoTitle || "").trim();
  if (patch.seoDescription !== undefined) {
    next.seo.description = String(patch.seoDescription || "").trim();
  }
  if (patch.favicon !== undefined) next.seo.favicon = String(patch.favicon || "").trim();
  if (patch.ogImage !== undefined) next.seo.ogImage = String(patch.ogImage || "").trim();
  if (patch.seoPageOverrides !== undefined) {
    next.seo.pageOverrides = normalizeSeoPageOverrides(patch.seoPageOverrides);
  }

  if (patch.googleAnalyticsId !== undefined) {
    next.integrations = next.integrations || {};
    next.integrations.googleAnalyticsId = String(patch.googleAnalyticsId || "").trim();
  }

  if (patch.contentGithubUsers !== undefined) {
    next.security = next.security || { contentGithubUsers: [] };
    next.security.contentGithubUsers = parseGithubUserCsv(patch.contentGithubUsers);
  }

  if (patch.sitemapExcludes !== undefined) {
    next.content = next.content || structuredClone(DEFAULT_SITE_CONFIG.content);
    next.content.sitemapExcludes = parseSitemapExcludeEntries(patch.sitemapExcludes);
  }

  if (
    patch.sitemapAutoExcludeEnabled !== undefined ||
    patch.sitemapAutoExcludeSections !== undefined ||
    patch.sitemapAutoExcludeDepthPages !== undefined ||
    patch.sitemapAutoExcludeDepthBlog !== undefined ||
    patch.sitemapAutoExcludeDepthPublications !== undefined ||
    patch.sitemapAutoExcludeDepthTeaching !== undefined
  ) {
    next.content = next.content || structuredClone(DEFAULT_SITE_CONFIG.content);
    const current = next.content.sitemapAutoExclude || structuredClone(DEFAULT_SITE_CONFIG.content.sitemapAutoExclude);
    const nextSections = patch.sitemapAutoExcludeSections !== undefined
      ? parseSitemapSectionList(patch.sitemapAutoExcludeSections)
      : current.excludeSections;
    const nextDepth: Partial<Record<SitemapSection, number>> = {
      ...current.maxDepthBySection,
    };

    if (patch.sitemapAutoExcludeDepthPages !== undefined) {
      const next = normalizeDepthStringMap(patch.sitemapAutoExcludeDepthPages);
      if (next === undefined) delete nextDepth.pages;
      else nextDepth.pages = next;
    }
    if (patch.sitemapAutoExcludeDepthBlog !== undefined) {
      const next = normalizeDepthStringMap(patch.sitemapAutoExcludeDepthBlog);
      if (next === undefined) delete nextDepth.blog;
      else nextDepth.blog = next;
    }
    if (patch.sitemapAutoExcludeDepthPublications !== undefined) {
      const next = normalizeDepthStringMap(patch.sitemapAutoExcludeDepthPublications);
      if (next === undefined) delete nextDepth.publications;
      else nextDepth.publications = next;
    }
    if (patch.sitemapAutoExcludeDepthTeaching !== undefined) {
      const next = normalizeDepthStringMap(patch.sitemapAutoExcludeDepthTeaching);
      if (next === undefined) delete nextDepth.teaching;
      else nextDepth.teaching = next;
    }

    next.content.sitemapAutoExclude = {
      enabled:
        patch.sitemapAutoExcludeEnabled !== undefined
          ? Boolean(patch.sitemapAutoExcludeEnabled)
          : current.enabled,
      excludeSections: nextSections,
      maxDepthBySection: nextDepth,
    };
  }

  if (patch.rootPageId !== undefined) {
    next.content = next.content || structuredClone(DEFAULT_SITE_CONFIG.content);
    const rootPageId = compactId(String(patch.rootPageId || "").trim());
    next.content.rootPageId = rootPageId || null;
  }
  if (patch.homePageId !== undefined) {
    next.content = next.content || structuredClone(DEFAULT_SITE_CONFIG.content);
    const homePageId = compactId(String(patch.homePageId || "").trim());
    next.content.homePageId = homePageId || null;
  }

  return next;
}

export async function updateFilesystemSiteSettingsRow(
  rowId: string,
  patch: Partial<Omit<SiteSettings, "rowId">>,
): Promise<void> {
  if (String(rowId || "").trim() !== SETTINGS_ROW_ID) {
    throw new Error("Unknown filesystem settings row");
  }
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const next = applySiteSettingsPatchToSourceConfig(sourceConfig, patch);
  await writeFilesystemSourceSiteConfig(next);
}

function createNavItemId(group: "top" | "more", input: { label: string; href: string }): string {
  return `fs-nav-${hashText(
    `${group}\n${input.label}\n${input.href}\n${crypto.randomUUID()}`,
  )}`;
}

function findNavRow(
  sourceConfig: SourceSiteConfig,
  rowId: string,
): { group: "top" | "more"; index: number } | null {
  const groups: Array<"top" | "more"> = ["top", "more"];
  for (const group of groups) {
    const index = sourceConfig.nav[group].findIndex((item) => item.id === rowId);
    if (index >= 0) return { group, index };
  }
  return null;
}

export function applyNavPatchToSourceConfig(
  sourceConfig: SourceSiteConfig,
  rowId: string,
  patch: Partial<Omit<NavItemRow, "rowId">>,
): SourceSiteConfig {
  const next = structuredClone(sourceConfig);
  const found = findNavRow(next, rowId);
  if (!found) throw new Error("Unknown filesystem nav row");

  const { group, index } = found;
  const current = next.nav[group][index]!;
  const targetGroup = patch.group === "top" ? "top" : patch.group === "more" ? "more" : group;
  const nextItem: SourceNavItem = {
    id: current.id,
    label: patch.label !== undefined ? String(patch.label || "").trim() : current.label,
    href: patch.href !== undefined ? String(patch.href || "").trim() : current.href,
    order: patch.order !== undefined ? Math.max(0, Math.floor(patch.order)) : current.order,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
  };

  const remaining = next.nav[group].filter((_, itemIndex) => itemIndex !== index);
  next.nav[group] = sortNavItems(remaining);
  next.nav[targetGroup] = insertNavItem(next.nav[targetGroup], nextItem, nextItem.order);
  return next;
}

export function appendNavRowToSourceConfig(
  sourceConfig: SourceSiteConfig,
  input: Omit<NavItemRow, "rowId">,
): { sourceConfig: SourceSiteConfig; created: NavItemRow } {
  const next = structuredClone(sourceConfig);
  const group: "top" | "more" = input.group === "top" ? "top" : "more";
  const nextItem: SourceNavItem = {
    id: createNavItemId(group, {
      label: String(input.label || "").trim(),
      href: String(input.href || "").trim(),
    }),
    label: String(input.label || "").trim(),
    href: String(input.href || "").trim(),
    order: Math.max(0, Math.floor(Number(input.order || 0))),
    enabled: input.enabled !== false,
  };
  next.nav[group] = insertNavItem(next.nav[group], nextItem, nextItem.order);
  const created = navRowsForGroup(group, next.nav[group]).find((row) => row.rowId === nextItem.id);
  if (!created) throw new Error("Failed to create filesystem nav row");
  return { sourceConfig: next, created };
}

export async function updateFilesystemNavRow(
  rowId: string,
  patch: Partial<Omit<NavItemRow, "rowId">>,
): Promise<void> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const next = applyNavPatchToSourceConfig(sourceConfig, rowId, patch);
  await writeFilesystemSourceSiteConfig(next);
}

function insertNavItem(
  items: SourceNavItem[],
  item: SourceNavItem,
  desiredOrder: number,
): SourceNavItem[] {
  const sorted = sortNavItems(items);
  const index = Math.max(0, Math.min(sorted.length, Math.floor(desiredOrder)));
  const next = [...sorted];
  next.splice(index, 0, item);
  return sortNavItems(next);
}

export async function createFilesystemNavRow(
  input: Omit<NavItemRow, "rowId">,
): Promise<NavItemRow> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const { sourceConfig: next, created } = appendNavRowToSourceConfig(sourceConfig, input);
  await writeFilesystemSourceSiteConfig(next);
  return created;
}

export function mapSourceRouteData(
  sourceConfig: SourceSiteConfig,
  protectedRoutes: ProtectedRoute[],
): {
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
} {
  const overrides = Object.entries(sourceConfig.content?.routeOverrides || {})
    .map(([pageId, routePath]) => {
      const pid = compactId(pageId);
      const normalized = normalizeRoutePath(routePath);
      if (!pid || !normalized) return null;
      return {
        rowId: `fs-override-${pid}`,
        pageId: pid,
        routePath: normalized,
        enabled: true as const,
      };
    })
    .filter((row): row is SiteAdminRouteOverride => Boolean(row));

  const protectedRows: SiteAdminProtectedRoute[] = protectedRoutes.map((row) => {
    const auth: ProtectedAccessMode = row.auth === "github" ? "github" : "password";
    return {
      rowId: row.id,
      pageId: compactId(row.pageId || ""),
      path: row.path,
      mode: row.mode,
      auth,
      enabled: true,
    };
  });

  return {
    adminPageId: "",
    overridesDbId: "",
    protectedDbId: "",
    overrides,
    protectedRoutes: protectedRows,
  };
}

export async function loadFilesystemSiteAdminRouteData(): Promise<{
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
}> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const protectedRoutes = await readFilesystemProtectedRoutes();
  return mapSourceRouteData(sourceConfig, protectedRoutes);
}

export function applyOverrideToSourceConfig(
  sourceConfig: SourceSiteConfig,
  input: {
    pageId: string;
    routePath: string;
  },
): { rowId: string; pageId: string; routePath: string; enabled: true; sourceConfig: SourceSiteConfig } {
  const next = structuredClone(sourceConfig);
  const pageId = compactId(input.pageId);
  const routePath = normalizeRoutePath(input.routePath);
  if (!pageId || !routePath) throw new Error("Invalid override input");
  next.content = next.content || structuredClone(DEFAULT_SITE_CONFIG.content);
  next.content.routeOverrides = {
    ...(next.content.routeOverrides || {}),
    [pageId]: routePath,
  };
  return { rowId: `fs-override-${pageId}`, pageId, routePath, enabled: true, sourceConfig: next };
}

export function removeOverrideFromSourceConfig(
  sourceConfig: SourceSiteConfig,
  input: { pageId: string },
): SourceSiteConfig {
  const next = structuredClone(sourceConfig);
  const pageId = compactId(input.pageId);
  if (!pageId || !next.content?.routeOverrides) return next;
  const nextOverrides = { ...(next.content.routeOverrides || {}) };
  delete nextOverrides[pageId];
  next.content.routeOverrides = nextOverrides;
  return next;
}

export async function upsertFilesystemOverride(input: {
  pageId: string;
  routePath: string;
}): Promise<{ rowId: string; pageId: string; routePath: string; enabled: true }> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const out = applyOverrideToSourceConfig(sourceConfig, input);
  await writeFilesystemSourceSiteConfig(out.sourceConfig);
  return out;
}

export async function disableFilesystemOverride(input: { pageId: string }): Promise<void> {
  const sourceConfig = await readFilesystemSourceSiteConfig();
  const next = removeOverrideFromSourceConfig(sourceConfig, input);
  await writeFilesystemSourceSiteConfig(next);
}

export function applyProtectedRouteToSourceRoutes(
  routes: ProtectedRoute[],
  input: {
    pageId: string;
    path: string;
    mode: "exact" | "prefix";
    password: string;
    auth: ProtectedAccessMode;
  },
): {
  routes: ProtectedRoute[];
  row: {
    rowId: string;
    pageId: string;
    path: string;
    mode: "exact" | "prefix";
    auth: ProtectedAccessMode;
    enabled: true;
  };
} {
  const pageId = compactId(input.pageId);
  const pathValue = normalizeRoutePath(input.path);
  if (!pageId || !pathValue) throw new Error("Invalid protected route input");
  const auth = input.auth === "github" ? "github" : "password";
  const token = auth === "password"
    ? sha256Hex(`${pageId || pathValue}\n${String(input.password || "").trim()}`)
    : sha256Hex(`github\n${pageId || pathValue}`);

  const nextRoute: ProtectedRoute = {
    id: pageId || hashText(`${auth}\n${pathValue}`),
    auth,
    key: "pageId",
    pageId,
    path: pathValue,
    mode: input.mode === "prefix" ? "prefix" : "exact",
    token,
  };

  const existingIndex = routes.findIndex((row) =>
    compactId(row.pageId || "") === pageId || normalizeRoutePath(row.path) === pathValue
  );
  const next = [...routes];
  if (existingIndex >= 0) next.splice(existingIndex, 1, nextRoute);
  else next.push(nextRoute);

  return {
    routes: next,
    row: {
      rowId: nextRoute.id,
      pageId,
      path: pathValue,
      mode: nextRoute.mode,
      auth,
      enabled: true,
    },
  };
}

export function removeProtectedRouteFromSourceRoutes(
  routes: ProtectedRoute[],
  input: {
    pageId: string;
    path: string;
  },
): ProtectedRoute[] {
  const pageId = compactId(input.pageId);
  const pathValue = normalizeRoutePath(input.path);
  return routes.filter((row) => {
    if (pageId && compactId(row.pageId || "") === pageId) return false;
    if (pathValue && normalizeRoutePath(row.path) === pathValue) return false;
    return true;
  });
}

export async function upsertFilesystemProtected(input: {
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: ProtectedAccessMode;
}): Promise<{
  rowId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: ProtectedAccessMode;
  enabled: true;
}> {
  const routes = await readFilesystemProtectedRoutes();
  const out = applyProtectedRouteToSourceRoutes(routes, input);
  await writeFilesystemProtectedRoutes(out.routes);
  return out.row;
}

export async function disableFilesystemProtected(input: {
  pageId: string;
  path: string;
}): Promise<void> {
  const routes = await readFilesystemProtectedRoutes();
  const next = removeProtectedRouteFromSourceRoutes(routes, input);
  await writeFilesystemProtectedRoutes(next);
}

export function normalizeSourceRouteManifestRows(rows: unknown[]): SourceRouteManifestItem[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const value = row as Record<string, unknown>;
      const routePath = normalizeRoutePath(String(value.routePath || ""));
      if (!routePath) return null;
      return {
        id: String(value.id || "").trim() || hashText(routePath),
        title: String(value.title || "").trim() || "Untitled",
        kind: String(value.kind || "").trim() || "page",
        routePath,
        parentId: String(value.parentId || "").trim(),
        parentRoutePath: normalizeRoutePath(String(value.parentRoutePath || "")) || "/",
      };
    })
    .filter((row): row is SourceRouteManifestItem => Boolean(row));
}

export async function readFilesystemSourceRouteManifest(): Promise<SourceRouteManifestItem[]> {
  const rows = await readJsonFile<unknown[]>(filesystemRoutesManifestFile(), []);
  return normalizeSourceRouteManifestRows(rows);
}

export async function readFilesystemRuntimeSiteConfig(): Promise<SiteConfig> {
  return buildRuntimeSiteConfig(await readFilesystemSourceSiteConfig());
}
