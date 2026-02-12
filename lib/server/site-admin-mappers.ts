import "server-only";

import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils.mjs";
import { getPropCheckbox, getPropNumber, getPropString } from "@/lib/notion/api";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
} from "@/lib/site-admin/api-types";
import { isObject } from "@/lib/server/validate";

export type RouteOverrideRow = SiteAdminRouteOverride;
export type ProtectedRouteRow = SiteAdminProtectedRoute;

export function mapSiteSettingsRow(row: unknown): SiteSettings | null {
  if (!isObject(row)) return null;
  const rowId = compactId(String(row.id || ""));
  if (!rowId) return null;
  return {
    rowId,
    siteName: getPropString(row, "Site Name"),
    lang: getPropString(row, "Lang") || "en",
    seoTitle: getPropString(row, "SEO Title"),
    seoDescription: getPropString(row, "SEO Description"),
    favicon: getPropString(row, "Favicon"),
    googleAnalyticsId: getPropString(row, "Google Analytics ID"),
    contentGithubUsers: getPropString(row, "Content GitHub Users"),
    rootPageId: getPropString(row, "Root Page ID"),
    homePageId: getPropString(row, "Home Page ID"),
  };
}

export function mapNavigationRows(rows: unknown[]): NavItemRow[] {
  const nav: NavItemRow[] = [];
  for (const row of rows) {
    if (!isObject(row)) continue;
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

export function mapRouteOverrideRows(rows: unknown[]): RouteOverrideRow[] {
  const overrides: RouteOverrideRow[] = [];
  for (const row of rows) {
    if (!isObject(row)) continue;
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

export function mapProtectedRouteRows(rows: unknown[]): ProtectedRouteRow[] {
  const protectedRoutes: ProtectedRouteRow[] = [];
  for (const row of rows) {
    if (!isObject(row)) continue;
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
