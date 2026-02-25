import {
  canonicalizeRoutePath,
  compactId,
  normalizeRoutePath,
} from "../shared/route-utils.mjs";

/**
 * Normalize a request pathname into a consistent form.
 * - trims whitespace
 * - removes trailing slash (except for "/")
 * @param {string} pathname
 * @returns {string}
 */
export function normalizePathname(pathname) {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

/**
 * Canonicalize "internal/source" routes into public routes.
 * - /blog/list/<slug> -> /blog/<slug>
 * - /blog/list -> /blog
 * - /list/<slug> -> /blog/<slug>
 * - /list -> /blog
 *
 * @param {string} routePath
 * @returns {string}
 */
export function canonicalizePublicRoute(routePath) {
  const p = normalizePathname(routePath);
  if (!p.startsWith("/")) return p;
  return canonicalizeRoutePath(p) || "/";
}

/**
 * If `pathname` is a bare 32-hex id path ("/<id>"), return its canonical route.
 * @param {string} pathname
 * @param {Record<string, string>} pageIdToRoute
 * @returns {string}
 */
export function resolveNotionIdPathRedirect(pathname, pageIdToRoute) {
  const p = normalizePathname(pathname);
  const m = p.match(/^\/([0-9a-f]{32})$/i);
  if (!m) return "";
  const id = m[1].toLowerCase();
  const target = pageIdToRoute?.[id] || "";
  if (!target) return "";
  const canon = normalizeRoutePath(target);
  if (!canon || canon === p) return "";
  return canon;
}

/**
 * Given a public pathname, return the compiled pageId (compact 32-hex) if resolvable.
 * Handles canonical blog URLs by mapping them back to the backing /blog/list structure.
 *
 * @param {string} pathname
 * @param {Record<string, unknown>} routesMap routePath -> pageId
 * @returns {string}
 */
export function lookupPageIdForPath(pathname, routesMap) {
  const p = canonicalizePublicRoute(normalizePathname(pathname));

  const direct = routesMap?.[p];
  if (typeof direct === "string" && direct) return compactId(direct);

  // Canonical blog routes (/blog/<slug>) map to /blog/list/<slug> (source structure).
  const m = p.match(/^\/blog\/([^/]+)$/);
  if (m) {
    const alt = `/blog/list/${m[1]}`;
    const hit = routesMap?.[alt];
    if (typeof hit === "string" && hit) return compactId(hit);
  }

  return "";
}

/**
 * Build a parent map from the routes manifest.
 * @param {unknown} routesManifest
 * @returns {Record<string, string>} pageId32 -> parentPageId32 ("" for root/unknown)
 */
export function buildParentByPageIdMap(routesManifest) {
  /** @type {Record<string, string>} */
  const out = {};
  try {
    const items = Array.isArray(routesManifest) ? routesManifest : [];
    for (const it of items) {
      const id = compactId(it?.id || "");
      if (!id) continue;
      const pid = compactId(it?.parentId || "");
      out[id] = pid || "";
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * @typedef {{
 *   id: string,
 *   auth?: "password" | "github",
 *   key?: "pageId" | "path",
 *   pageId?: string,
 *   path: string,
 *   mode: "exact" | "prefix",
 *   token: string,
 * }} ProtectedRoute
 */

/**
 * Find a best matching protected rule by URL path.
 * Product decision: "exact" still protects subtree (Super-like).
 *
 * @param {string} pathname
 * @param {ProtectedRoute[]} rules
 * @returns {ProtectedRoute | null}
 */
export function findProtectedMatch(pathname, rules) {
  const p = normalizePathname(pathname);

  for (const r of rules) {
    if (r.mode !== "exact") continue;
    const rp = normalizePathname(r.path);
    if (rp === p || p.startsWith(`${rp}/`)) return r;
  }

  let best = null;
  for (const r of rules) {
    if (r.mode !== "prefix") continue;
    const rp = normalizePathname(r.path);
    if (rp === "/") continue;
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (!best || rp.length > normalizePathname(best.path).length) best = r;
    }
  }
  return best;
}

/**
 * Find a best matching protected rule by page hierarchy.
 * @param {string} pageId32
 * @param {ProtectedRoute[]} rules
 * @param {Record<string, string>} parentByPageId
 * @returns {ProtectedRoute | null}
 */
export function findProtectedByPageHierarchy(pageId32, rules, parentByPageId) {
  /** @type {Record<string, ProtectedRoute>} */
  const byId = {};
  for (const r of rules) {
    if ((r.key || "") !== "pageId") continue;
    const pid = compactId(r.pageId || r.id || "");
    if (!pid) continue;
    // Prefer password rules over github when both exist on the same node (rare).
    if (!byId[pid] || (byId[pid].auth || "password") !== "password") byId[pid] = r;
  }

  let cur = compactId(pageId32);
  let guard = 0;
  while (cur && guard++ < 200) {
    const hit = byId[cur];
    if (hit) return hit;
    cur = parentByPageId?.[cur] || "";
  }
  return null;
}

/**
 * Prefer page-hierarchy rules (stable under URL overrides), then fall back to path matching.
 * @param {string} pathname
 * @param {ProtectedRoute[]} rules
 * @param {Record<string, unknown>} routesMap
 * @param {Record<string, string>} parentByPageId
 * @returns {ProtectedRoute | null}
 */
export function pickProtectedRule(pathname, rules, routesMap, parentByPageId) {
  const pageId = lookupPageIdForPath(pathname, routesMap);
  const byPage = pageId ? findProtectedByPageHierarchy(pageId, rules, parentByPageId) : null;
  return byPage || findProtectedMatch(pathname, rules);
}

/**
 * Map a canonical public blog post URL back to the backing source route.
 * Returns "" for non-blog paths.
 *
 * @param {string} pathname
 * @returns {string}
 */
export function blogSourceRouteForPublicPath(pathname) {
  const p = canonicalizePublicRoute(normalizePathname(pathname));
  const m = p.match(/^\/blog\/([^/]+)$/);
  if (!m) return "";
  return `/blog/list/${m[1]}`;
}
