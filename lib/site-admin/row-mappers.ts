import { getPropCheckbox, getPropNumber, getPropString } from "../notion/api.ts";
import type { NotionPageLike } from "../notion/types.ts";
import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
} from "./api-types.ts";
import type { NavItemRow, SiteSettings } from "./types.ts";

export type RouteOverrideRow = SiteAdminRouteOverride;
export type ProtectedRouteRow = SiteAdminProtectedRoute;

function parseBooleanString(raw: string): boolean | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return null;
}

function parseNumberString(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return String(Math.floor(n));
}

function mapDepthField(row: NotionPageLike, key: string): string {
  const n = getPropNumber(row, key);
  if (typeof n === "number" && Number.isFinite(n)) return String(Math.floor(n));
  return parseNumberString(getPropString(row, key));
}

export function mapSiteSettingsRow(row: NotionPageLike | null | undefined): SiteSettings | null {
  if (!row) return null;
  const rowId = compactId(String(row.id || ""));
  if (!rowId) return null;
  const autoExcludeBool = getPropCheckbox(row, "Sitemap Auto Exclude Enabled");
  const autoExcludeText = parseBooleanString(
    getPropString(row, "Sitemap Auto Exclude Enabled"),
  );
  return {
    rowId,
    siteName: getPropString(row, "Site Name"),
    lang: getPropString(row, "Lang") || "en",
    seoTitle: getPropString(row, "SEO Title"),
    seoDescription: getPropString(row, "SEO Description"),
    favicon: getPropString(row, "Favicon"),
    ogImage: getPropString(row, "OG Image"),
    googleAnalyticsId: getPropString(row, "Google Analytics ID"),
    contentGithubUsers: getPropString(row, "Content GitHub Users"),
    sitemapExcludes: getPropString(row, "Sitemap Excludes"),
    sitemapAutoExcludeEnabled: autoExcludeBool ?? autoExcludeText ?? true,
    sitemapAutoExcludeSections: getPropString(row, "Sitemap Auto Exclude Sections"),
    sitemapAutoExcludeDepthPages: mapDepthField(row, "Sitemap Max Depth Pages"),
    sitemapAutoExcludeDepthBlog: mapDepthField(row, "Sitemap Max Depth Blog"),
    sitemapAutoExcludeDepthPublications: mapDepthField(
      row,
      "Sitemap Max Depth Publications",
    ),
    sitemapAutoExcludeDepthTeaching: mapDepthField(row, "Sitemap Max Depth Teaching"),
    rootPageId: getPropString(row, "Root Page ID"),
    homePageId: getPropString(row, "Home Page ID"),
  };
}

export function mapNavigationRows(rows: NotionPageLike[]): NavItemRow[] {
  const nav: NavItemRow[] = [];
  for (const row of rows) {
    const rowId = compactId(String(row.id || ""));
    if (!rowId) continue;
    const groupRaw = (getPropString(row, "Group") || "more").toLowerCase();
    const group = groupRaw === "top" ? "top" : "more";
    nav.push({
      rowId,
      label: getPropString(row, "Label") || getPropString(row, "Name"),
      href: getPropString(row, "Href"),
      group,
      order: getPropNumber(row, "Order") ?? 0,
      enabled: (getPropCheckbox(row, "Enabled") ?? true) === true,
    });
  }
  nav.sort((a, b) => {
    if (a.group !== b.group) return a.group === "top" ? -1 : 1;
    if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
    return a.label.localeCompare(b.label);
  });
  return nav;
}

export function mapRouteOverrideRows(rows: NotionPageLike[]): RouteOverrideRow[] {
  const overrides: RouteOverrideRow[] = [];
  for (const row of rows) {
    const enabled = getPropCheckbox(row, "Enabled");
    if (enabled === false) continue;
    const rowId = compactId(String(row.id || ""));
    const pageId = compactId(getPropString(row, "Page ID"));
    const routePath = normalizeRoutePath(getPropString(row, "Route Path"));
    if (!rowId || !pageId || !routePath) continue;
    overrides.push({ rowId, pageId, routePath, enabled: true });
  }
  return overrides;
}

export function mapProtectedRouteRows(rows: NotionPageLike[]): ProtectedRouteRow[] {
  const protectedRoutes: ProtectedRouteRow[] = [];
  for (const row of rows) {
    const enabled = getPropCheckbox(row, "Enabled");
    if (enabled === false) continue;
    const rowId = compactId(String(row.id || ""));
    if (!rowId) continue;
    const pageId = compactId(getPropString(row, "Page ID"));
    const path = normalizeRoutePath(getPropString(row, "Path"));
    if (!path) continue;
    const modeRaw = (getPropString(row, "Mode") || "exact").toLowerCase();
    const mode: "exact" | "prefix" = modeRaw === "prefix" ? "prefix" : "exact";
    const authRaw = (getPropString(row, "Auth") || "").toLowerCase();
    const auth: "password" | "github" = authRaw === "github" ? "github" : "password";
    protectedRoutes.push({ rowId, pageId, path, mode, auth, enabled: true });
  }
  return protectedRoutes;
}
