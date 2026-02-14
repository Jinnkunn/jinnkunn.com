import { listBlockChildrenCached } from "./block-children-cache.mjs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {import("./types.ts").NotionBlock} NotionBlock
 */

/**
 * @param {NotionBlock[]} blocks
 * @returns {Promise<NotionBlock[]>}
 */
export async function hydrateBlocks(blocks) {
  for (const b of blocks || []) {
    if (!isRecord(b)) continue;
    // Avoid hydrating child pages/databases: we only render them as links,
    // and pulling their full subtree makes search noisy + sync slower.
    const t = String(b.type || "");
    const shouldSkip = t === "child_page" || t === "child_database" || t === "link_to_page";

    if (b.has_children && !shouldSkip) {
      const kids = await listBlockChildrenCached(b.id);
      b.__children = await hydrateBlocks(kids);
    }
  }
  return blocks || [];
}
