import { DEFAULT_SITE_CONFIG } from "../../lib/shared/default-site-config.mjs";
import { getPropCheckbox, getPropNumber, getPropString, queryDatabase } from "../../lib/notion/api.mjs";
import { compactId, normalizeRoutePath, slugify } from "../../lib/shared/route-utils.mjs";
import { findChildDatabases } from "./notion-tree.mjs";
import { sha256Hex } from "./crypto-utils.mjs";

const DEFAULT_CONFIG = DEFAULT_SITE_CONFIG;

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseGithubUserList(raw) {
  const items = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^@/, "").toLowerCase());
  // Dedupe but keep stable ordering.
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

/**
 * @param {Array<{id: string, title: string}>} databases
 * @param {string} title
 */
function findDbByTitle(databases, title) {
  const want = slugify(title);
  return databases.find((d) => slugify(d.title) === want) || null;
}

/**
 * Keep external links intact; normalize internal hrefs.
 * @param {string} href
 * @returns {string}
 */
function normalizeHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(raw)) return raw;
  return normalizeRoutePath(raw);
}

/**
 * Loads Site Settings / Navigation / Route Overrides from the provisioned Site Admin databases.
 * @param {string} adminPageId
 * @returns {Promise<any|null>}
 */
export async function loadConfigFromAdminDatabases(adminPageId) {
  // These databases are provisioned by `scripts/provision-site-admin.mjs`.
  const databases = await findChildDatabases(adminPageId);
  const settingsDb = findDbByTitle(databases, "Site Settings");
  const navDb = findDbByTitle(databases, "Navigation");
  const overridesDb = findDbByTitle(databases, "Route Overrides");

  if (!settingsDb && !navDb && !overridesDb) return null;

  const cfg = structuredClone(DEFAULT_CONFIG);

  // 1) Site Settings (single-row)
  if (settingsDb) {
    const rows = await queryDatabase(settingsDb.id);
    const row = rows[0];
    if (row) {
      const siteName = getPropString(row, "Site Name");
      const lang = getPropString(row, "Lang");
      const seoTitle = getPropString(row, "SEO Title");
      const seoDescription = getPropString(row, "SEO Description");
      const favicon = getPropString(row, "Favicon");
      const gaId = getPropString(row, "Google Analytics ID");
      const contentGithubUsers = getPropString(row, "Content GitHub Users");
      const rootPageId = getPropString(row, "Root Page ID");
      const homePageId = getPropString(row, "Home Page ID");

      if (siteName) cfg.siteName = siteName;
      if (lang) cfg.lang = lang;
      if (seoTitle) cfg.seo.title = seoTitle;
      if (seoDescription) cfg.seo.description = seoDescription;
      if (favicon) cfg.seo.favicon = favicon;
      if (gaId) {
        cfg.integrations = cfg.integrations || {};
        cfg.integrations.googleAnalyticsId = gaId;
      }
      if (contentGithubUsers) {
        cfg.security = cfg.security || { contentGithubUsers: [] };
        cfg.security.contentGithubUsers = parseGithubUserList(contentGithubUsers);
      }
      if (rootPageId) cfg.content.rootPageId = rootPageId;
      if (homePageId) cfg.content.homePageId = homePageId;
    }
  }

  // 2) Navigation items
  if (navDb) {
    const rows = await queryDatabase(navDb.id);
    const top = [];
    const more = [];
    for (const row of rows) {
      const enabled = getPropCheckbox(row, "Enabled");
      if (enabled === false) continue;
      const group = (getPropString(row, "Group") || "").toLowerCase();
      const href = normalizeHref(getPropString(row, "Href")) || "";
      const label = getPropString(row, "Label") || getPropString(row, "Name");
      const order = getPropNumber(row, "Order") ?? 0;
      if (!href || !label) continue;
      const item = { label, href, order };
      if (group === "top") top.push(item);
      else more.push(item);
    }
    top.sort((a, b) => (a.order || 0) - (b.order || 0));
    more.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (top.length || more.length) cfg.nav = { top, more };
  }

  // 3) Route overrides
  if (overridesDb) {
    const rows = await queryDatabase(overridesDb.id);
    const overrides = {};
    for (const row of rows) {
      const enabled = getPropCheckbox(row, "Enabled");
      if (enabled === false) continue;
      const pageId = getPropString(row, "Page ID");
      const routePath = normalizeRoutePath(getPropString(row, "Route Path"));
      if (!pageId || !routePath) continue;
      overrides[pageId] = routePath;
    }
    if (Object.keys(overrides).length) cfg.content.routeOverrides = overrides;
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
  const items = rows
    .map((row) => {
      const enabled = getPropCheckbox(row, "Enabled");
      if (enabled === false) return null;

      const pageIdRaw = getPropString(row, "Page ID");
      const pageId = compactId(pageIdRaw);
      if (!pageId) return null;

      const routePath = normalizeRoutePath(getPropString(row, "Route Path"));
      const order = getPropNumber(row, "Order") ?? 0;
      const name = getPropString(row, "Name") || getPropString(row, "Title") || "";

      return { pageId, routePath: routePath || "", order, name };
    })
    .filter(Boolean);

  items.sort((a, b) => {
    if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return items;
}

/**
 * Protected routes are configured in a database so admins can set "password" or "github" auth.
 * @param {string} adminPageId
 * @param {{ routeToPageId?: Map<string, string> }} [opts]
 * @returns {Promise<any[]>}
 */
export async function loadProtectedRoutesFromAdminDatabases(adminPageId, opts = {}) {
  const { routeToPageId } = opts;
  const databases = await findChildDatabases(adminPageId);
  const protectedDb = findDbByTitle(databases, "Protected Routes");
  if (!protectedDb) return [];

  const rows = await queryDatabase(protectedDb.id);
  const out = [];

  for (const row of rows) {
    const enabled = getPropCheckbox(row, "Enabled");
    if (enabled === false) continue;

    const rawPath = getPropString(row, "Path");
    const path = rawPath ? normalizeRoutePath(rawPath) : "";
    const password = getPropString(row, "Password");
    const pageId = compactId(getPropString(row, "Page ID")) || (path && routeToPageId?.get(path)) || "";

    const authRaw = (getPropString(row, "Auth") || "").trim().toLowerCase();
    const auth = authRaw === "github" ? "github" : "password";

    // For password auth we need a password. For GitHub auth we don't.
    if (auth === "password" && (!password || (!pageId && !path))) continue;
    if (auth === "github" && (!pageId && !path)) continue;

    const modeRaw = (getPropString(row, "Mode") || "exact").toLowerCase();
    const mode = modeRaw === "prefix" ? "prefix" : "exact";

    // Prefer pageId-based rules (stable under URL overrides). Fall back to path-based.
    const key = pageId ? "pageId" : "path";
    const id = pageId || compactId(row.id).slice(0, 12);
    const token = auth === "password" ? sha256Hex(`${pageId || path}\n${password}`) : "";

    out.push({
      id,
      auth,
      key,
      pageId: pageId || "",
      path: path || "",
      mode,
      token,
    });
  }

  // Deterministic order:
  // - pageId rules before path rules (more robust)
  // - exact before prefix (legacy)
  // - longer paths first for prefix matching (legacy)
  out.sort((a, b) => {
    if (a.key !== b.key) return a.key === "pageId" ? -1 : 1;
    if (a.mode !== b.mode) return a.mode === "exact" ? -1 : 1;
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return a.path.localeCompare(b.path);
  });

  return out;
}
