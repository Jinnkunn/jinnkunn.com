import { getPropCheckbox, getPropNumber, getPropString } from "../../lib/notion/index.mjs";
import { compactId, normalizeRoutePath } from "../../lib/shared/route-utils.mjs";
import { parseSitemapExcludeEntries } from "../../lib/shared/sitemap-excludes.mjs";
import { sha256Hex } from "./crypto-utils.mjs";
import { normalizeHref } from "./page-meta.mjs";

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
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, unknown>} row
 */
export function applySiteSettingsRow(cfg, row) {
  if (!cfg || !row) return;

  const siteName = getPropString(row, "Site Name");
  const lang = getPropString(row, "Lang");
  const seoTitle = getPropString(row, "SEO Title");
  const seoDescription = getPropString(row, "SEO Description");
  const favicon = getPropString(row, "Favicon");
  const gaId = getPropString(row, "Google Analytics ID");
  const contentGithubUsers = getPropString(row, "Content GitHub Users");
  const sitemapExcludesRaw = getPropString(row, "Sitemap Excludes");
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
  if (sitemapExcludesRaw) {
    cfg.content = cfg.content || {};
    cfg.content.sitemapExcludes = parseSitemapExcludeEntries(sitemapExcludesRaw);
  }
  if (rootPageId) cfg.content.rootPageId = rootPageId;
  if (homePageId) cfg.content.homePageId = homePageId;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{ top: Array<{ label: string, href: string, order: number }>, more: Array<{ label: string, href: string, order: number }> } | null}
 */
export function mapNavigationRows(rows) {
  /** @type {Array<{ label: string, href: string, order: number }>} */
  const top = [];
  /** @type {Array<{ label: string, href: string, order: number }>} */
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
  if (!top.length && !more.length) return null;
  return { top, more };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Record<string, string> | null}
 */
export function mapRouteOverrideRows(rows) {
  /** @type {Record<string, string>} */
  const overrides = {};

  for (const row of rows) {
    const enabled = getPropCheckbox(row, "Enabled");
    if (enabled === false) continue;
    const pageId = getPropString(row, "Page ID");
    const routePath = normalizeRoutePath(getPropString(row, "Route Path"));
    if (!pageId || !routePath) continue;
    overrides[pageId] = routePath;
  }

  return Object.keys(overrides).length ? overrides : null;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<{pageId: string, routePath: string, order: number, name: string}>}
 */
export function mapIncludedPageRows(rows) {
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
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ routeToPageId?: Map<string, string> }} [opts]
 * @returns {Array<{ id: string, auth: "password" | "github", key: "pageId" | "path", pageId: string, path: string, mode: "exact" | "prefix", token: string }>}
 */
export function mapProtectedRouteRows(rows, opts = {}) {
  const { routeToPageId } = opts;
  /** @type {Array<{ id: string, auth: "password" | "github", key: "pageId" | "path", pageId: string, path: string, mode: "exact" | "prefix", token: string }>} */
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

    if (auth === "password" && (!password || (!pageId && !path))) continue;
    if (auth === "github" && (!pageId && !path)) continue;

    const modeRaw = (getPropString(row, "Mode") || "exact").toLowerCase();
    const mode = modeRaw === "prefix" ? "prefix" : "exact";
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

  out.sort((a, b) => {
    if (a.key !== b.key) return a.key === "pageId" ? -1 : 1;
    if (a.mode !== b.mode) return a.mode === "exact" ? -1 : 1;
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return a.path.localeCompare(b.path);
  });

  return out;
}
