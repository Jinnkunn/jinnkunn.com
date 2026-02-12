import { compactId } from "../shared/route-utils.mjs";
import { listBlockChildren, notionRequest } from "./api.mjs";

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

// Cache database -> canonical parent page id so we can ignore linked database views.
/** @type {Map<string, string>} */
const __dbParentPageCache = new Map(); // dbId -> parentPageId ("" if workspace/unknown)

/**
 * @param {string} databaseId
 * @returns {Promise<string>}
 */
export async function getDatabaseParentPageId(databaseId) {
  const dbId = compactId(databaseId);
  if (!dbId) return "";
  if (__dbParentPageCache.has(dbId)) return __dbParentPageCache.get(dbId);
  const db = await notionRequest(`databases/${dbId}`);
  const parent = isRecord(db) && isRecord(db.parent) ? db.parent : null;
  const parentPageId = parent && parent.type === "page_id"
    ? compactId(String(parent.page_id || ""))
    : "";
  __dbParentPageCache.set(dbId, parentPageId);
  return parentPageId;
}

/**
 * @param {string} databaseId
 * @returns {Promise<{ id: string, title: string, lastEdited: string }>}
 */
export async function getDatabaseInfo(databaseId) {
  const dbId = compactId(databaseId);
  if (!dbId) return { id: "", title: "Database", lastEdited: "" };
  const db = await notionRequest(`databases/${dbId}`);
  const titleArr = isRecord(db) && Array.isArray(db.title) ? db.title : [];
  const firstTitle = titleArr[0];
  const title = isRecord(firstTitle)
    ? String(firstTitle.plain_text || "").trim() || "Database"
    : "Database";
  const lastEdited = isRecord(db) ? String(db.last_edited_time || "").trim() : "";
  return { id: dbId, title, lastEdited };
}

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

/**
 * Find the first code block containing valid JSON.
 * Returns both the block id and the JSON string so callers can archive/update
 * the old config block if needed.
 *
 * @param {string} blockId
 * @param {number} [maxDepth]
 * @returns {Promise<{ blockId: string, json: string } | null>}
 */
export async function findFirstJsonCodeBlock(blockId, maxDepth = 4) {
  const blocks = await listBlockChildrenCached(blockId);
  for (const b of blocks) {
    if (b.type !== "code") continue;
    const rt = b.code && Array.isArray(b.code.rich_text) ? b.code.rich_text : [];
    const text = rt.map((x) => (isRecord(x) ? String(x.plain_text ?? "") : "")).join("");
    const t = text.trim();
    if (!t.startsWith("{")) continue;
    try {
      JSON.parse(t);
      return { blockId: compactId(String(b.id || "")), json: t };
    } catch {
      // keep searching
    }
  }

  if (maxDepth <= 0) return null;
  for (const b of blocks) {
    if (!b.has_children) continue;
    const found = await findFirstJsonCodeBlock(b.id, maxDepth - 1);
    if (found) return found;
  }

  return null;
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
