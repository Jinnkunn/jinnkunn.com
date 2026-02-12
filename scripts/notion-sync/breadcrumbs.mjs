import { escapeHtml } from "../../lib/shared/text-utils.mjs";

/**
 * @typedef {object} BreadcrumbNode
 * @property {string} id
 * @property {string} routePath
 * @property {string} [title]
 * @property {string} [parentId]
 */

/**
 * Render a Super-like breadcrumbs row using the discovered page hierarchy.
 * Product requirement: homepage is always labeled "Home".
 *
 * @param {BreadcrumbNode | null | undefined} node
 * @param {unknown} _cfg
 * @param {{homePageId?: string, nodeById?: Map<string, BreadcrumbNode>}} ctx
 * @returns {string}
 */
export function renderBreadcrumbs(node, _cfg, ctx) {
  if (!node || node.routePath === "/") return "";

  const homePageId = String(ctx?.homePageId ?? "").trim();
  const nodeById = ctx?.nodeById instanceof Map ? ctx.nodeById : null;

  const HOME_LABEL = "Home";

  const chain = [];
  const seen = new Set();
  let cur = node;

  while (cur && cur.id && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    if (cur.id === homePageId || cur.routePath === "/") break;
    const parentId = String(cur.parentId || "").trim();
    if (!parentId || !nodeById) break;
    cur = nodeById.get(parentId) || null;
  }

  chain.reverse();

  if (!chain.length || chain[0].routePath !== "/") {
    chain.unshift({
      id: homePageId || "home",
      title: HOME_LABEL,
      routePath: "/",
    });
  }

  const items = chain
    .filter((n) => n && typeof n === "object" && n.routePath)
    .map((n) => {
      const isHome = n.routePath === "/" || (homePageId && n.id === homePageId);
      const label = isHome ? HOME_LABEL : String(n.title || "").trim() || "Untitled";
      const idAttr = n.id ? ` id="block-${escapeHtml(n.id)}"` : "";
      return `<a${idAttr} href="${escapeHtml(
        n.routePath,
      )}" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">${escapeHtml(
        label,
      )}</div></a>`;
    });

  const joined = items.join('<span class="notion-breadcrumb__divider">/</span>');
  return `<div class="super-navbar__breadcrumbs"><div class="notion-breadcrumb">${joined}</div></div>`;
}
