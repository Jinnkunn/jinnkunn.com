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

export function mapSiteSettingsRow(row: NotionPageLike | null | undefined): SiteSettings | null {
  if (!row) return null;
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
