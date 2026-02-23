import { DEFAULT_SITE_CONFIG } from "../../lib/shared/default-site-config.mjs";
import {
  queryDatabase,
  findChildDatabases,
  findDbByTitle,
} from "../../lib/notion/index.mjs";
import {
  applySiteSettingsRow,
  mapIncludedPageRows,
  mapNavigationRows,
  mapProtectedRouteRows,
  mapRouteOverrideRows,
  parseGithubUserList,
} from "./site-admin-row-mappers.mjs";

const DEFAULT_CONFIG = DEFAULT_SITE_CONFIG;

/**
 * @typedef {{label: string, href: string, order: number}} NavItem
 */

/**
 * @typedef {{top: NavItem[], more: NavItem[]}} NavConfig
 */

/**
 * @typedef {{
 *   siteName?: string,
 *   lang?: string,
 *   seo?: {title?: string, description?: string, favicon?: string},
 *   integrations?: {googleAnalyticsId?: string},
 *   security?: {contentGithubUsers?: string[]},
 *   content?: {rootPageId?: string, homePageId?: string, routeOverrides?: Record<string, string>, sitemapExcludes?: string[]},
 *   nav?: NavConfig
 * }} SiteConfigRecord
 */

/**
 * @typedef {{
 *   id: string,
 *   auth: "password"|"github",
 *   key: "pageId"|"path",
 *   pageId: string,
 *   path: string,
 *   mode: "exact"|"prefix",
 *   token: string
 * }} ProtectedRouteConfig
 */

export { parseGithubUserList };

/**
 * Loads Site Settings / Navigation / Route Overrides from the provisioned Site Admin databases.
 * @param {string} adminPageId
 * @returns {Promise<SiteConfigRecord|null>}
 */
export async function loadConfigFromAdminDatabases(adminPageId) {
  // These databases are provisioned by `scripts/provision-site-admin.mjs`.
  const databases = await findChildDatabases(adminPageId);
  const settingsDb = findDbByTitle(databases, "Site Settings");
  const navDb = findDbByTitle(databases, "Navigation");
  const overridesDb = findDbByTitle(databases, "Route Overrides");

  if (!settingsDb && !navDb && !overridesDb) return null;

  /** @type {SiteConfigRecord} */
  const cfg = structuredClone(DEFAULT_CONFIG);

  // 1) Site Settings (single-row)
  if (settingsDb) {
    const rows = await queryDatabase(settingsDb.id);
    const row = rows[0];
    if (row) {
      applySiteSettingsRow(cfg, row);
    }
  }

  // 2) Navigation items
  if (navDb) {
    const rows = await queryDatabase(navDb.id);
    const nav = mapNavigationRows(rows);
    if (nav) cfg.nav = nav;
  }

  // 3) Route overrides
  if (overridesDb) {
    const rows = await queryDatabase(overridesDb.id);
    const overrides = mapRouteOverrideRows(rows);
    if (overrides) cfg.content.routeOverrides = overrides;
  }

  return cfg;
}

/**
 * @param {string} adminPageId
 * @returns {Promise<Array<{pageId: string, routePath: string, order: number, name: string}>>}
 */
export async function loadIncludedPagesFromAdminDatabases(adminPageId) {
  const databases = await findChildDatabases(adminPageId);
  const includedDb = findDbByTitle(databases, "Included Pages");
  if (!includedDb) return [];

  const rows = await queryDatabase(includedDb.id);
  return mapIncludedPageRows(rows);
}

/**
 * Protected routes are configured in a database so admins can set "password" or "github" auth.
 * @param {string} adminPageId
 * @param {{ routeToPageId?: Map<string, string> }} [opts]
 * @returns {Promise<ProtectedRouteConfig[]>}
 */
export async function loadProtectedRoutesFromAdminDatabases(adminPageId, opts = {}) {
  const { routeToPageId } = opts;
  const databases = await findChildDatabases(adminPageId);
  const protectedDb = findDbByTitle(databases, "Protected Routes");
  if (!protectedDb) return [];

  const rows = await queryDatabase(protectedDb.id);
  return mapProtectedRouteRows(rows, { routeToPageId });
}
