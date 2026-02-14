import { compactId } from "../shared/route-utils.mjs";
import { listBlockChildren } from "./api.mjs";

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
 * @typedef {import("./types.ts").NotionDatabaseRef} NotionDatabaseRef
 */

// Cache to avoid re-fetching children when we need to traverse deep block trees.
// Keyed by compact block ID.
/** @type {Map<string, NotionBlock[]>} */
const __blockChildrenCache = new Map();

/**
 * @param {string} blockId
 * @returns {Promise<NotionBlock[]>}
 */
export async function listBlockChildrenCached(blockId) {
  const key = compactId(blockId) || String(blockId || "").trim();
  if (!key) return [];
  if (__blockChildrenCache.has(key)) return __blockChildrenCache.get(key);
  const kids = await listBlockChildren(key);
  const safeKids = Array.isArray(kids)
    ? kids.filter(isRecord)
    : [];
  __blockChildrenCache.set(key, /** @type {NotionBlock[]} */ (safeKids));
  return __blockChildrenCache.get(key) || [];
}

/**
 * @param {string} blockId
 * @param {number} [maxDepth]
 * @returns {Promise<NotionDatabaseRef[]>}
 */
export async function findChildDatabases(blockId, maxDepth = 4) {
  /** @type {NotionDatabaseRef[]} */
  const out = [];
  const blocks = await listBlockChildrenCached(blockId);
  for (const b of blocks) {
    if (b.type === "child_database") {
      out.push({
        id: compactId(String(b.id || "")),
        title: String((b.child_database && b.child_database.title) || ""),
      });
      continue;
    }
  }

  if (maxDepth <= 0) return out;
  for (const b of blocks) {
    if (!b.has_children) continue;
    out.push(...(await findChildDatabases(b.id, maxDepth - 1)));
  }

  return out;
}
