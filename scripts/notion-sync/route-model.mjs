import { compactId, normalizeRoutePath, slugify } from "../../lib/shared/route-utils.mjs";
import { canonicalizePublicRoute } from "../../lib/routes/strategy.mjs";

/**
 * @typedef {object} RouteNode
 * @property {string} id
 * @property {"page"|"database"|string} [kind]
 * @property {string} [title]
 * @property {RouteNode[]} [children]
 * @property {string} [routePath]
 * @property {string[]} [routeSegments]
 */

/**
 * @typedef {object} SiteContentConfig
 * @property {string} [homePageId]
 */

/**
 * @typedef {object} SiteConfigLike
 * @property {SiteContentConfig} [content]
 */

/**
 * @param {RouteNode[]} nodes
 * @param {SiteConfigLike | null | undefined} cfg
 * @returns {string}
 */
export function pickHomePageId(nodes, cfg) {
  const configured = compactId(cfg?.content?.homePageId);
  if (configured) return configured;
  const pageNodes = (nodes || []).filter((n) => n?.kind !== "database");
  const byTitle = pageNodes.find((n) => {
    const s = slugify(n.title);
    return s === "home" || s === "index";
  });
  if (byTitle) return byTitle.id;
  return pageNodes[0]?.id ?? "";
}

/**
 * Mutates node.routeSegments + node.routePath based on title + overrides + hierarchy.
 *
 * @param {RouteNode[]} nodes
 * @param {{homePageId:string, routeOverrides?: Map<string,string>}} opts
 * @param {string[]} parentSegments
 */
export function assignRoutes(nodes, { homePageId, routeOverrides }, parentSegments = []) {
  const used = new Set();

  for (const n of nodes || []) {
    const desired = slugify(n.title) || `page-${String(n.id || "").slice(0, 8)}`;

    if (parentSegments.length === 0 && n.id === homePageId) {
      n.routeSegments = [];
      n.routePath = "/";
    } else if (routeOverrides && routeOverrides.has(n.id)) {
      const routePath = normalizeRoutePath(routeOverrides.get(n.id));
      n.routePath = routePath;
      n.routeSegments = routePath === "/" ? [] : routePath.split("/").filter(Boolean);
    } else {
      let seg = desired;
      if (used.has(seg)) seg = `${seg}-${String(n.id || "").slice(0, 6)}`;
      used.add(seg);
      n.routeSegments = [...parentSegments, seg];
      n.routePath = `/${n.routeSegments.join("/")}`;
    }

    const nextParentSegments = n.routePath === "/" ? [] : n.routeSegments;
    assignRoutes(n.children, { homePageId, routeOverrides }, nextParentSegments);
  }
}

/**
 * @param {RouteNode[]} nodes
 * @returns {RouteNode[]}
 */
export function flattenPages(nodes) {
  /** @type {RouteNode[]} */
  const out = [];
  const walk = (n) => {
    out.push(n);
    for (const c of n.children || []) walk(c);
  };
  for (const n of nodes || []) walk(n);
  return out;
}

/**
 * Map a route path to a "rel" HTML file (for static-like exports).
 * @param {string} routePath
 * @returns {string}
 */
export function routePathToHtmlRel(routePath) {
  if (routePath === "/") return "index.html";
  return String(routePath || "").replace(/^\/+/, "") + ".html";
}

/**
 * Canonicalize internal/source blog paths to public paths, without touching external URLs.
 * @param {string} href
 * @returns {string}
 */
export function canonicalizePublicHref(href) {
  const p = String(href || "");
  if (!p.startsWith("/")) return p;
  return canonicalizePublicRoute(p);
}
