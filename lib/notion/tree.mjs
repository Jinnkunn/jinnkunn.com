import { compactId } from "../shared/route-utils.mjs";
import { listBlockChildren, notionRequest } from "./api.mjs";

// Cache to avoid re-fetching children when we need to traverse deep block trees.
// Keyed by compact block ID.
const __blockChildrenCache = new Map();

/**
 * @param {string} blockId
 * @returns {Promise<any[]>}
 */
export async function listBlockChildrenCached(blockId) {
  const key = compactId(blockId) || String(blockId || "").trim();
  if (!key) return [];
  if (__blockChildrenCache.has(key)) return __blockChildrenCache.get(key);
  const kids = await listBlockChildren(key);
  __blockChildrenCache.set(key, kids);
  return kids;
}

// Cache database -> canonical parent page id so we can ignore linked database views.
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
  const parent = db?.parent ?? null;
  const parentPageId = parent && parent.type === "page_id" ? compactId(parent.page_id) : "";
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
  const title = String(db?.title?.[0]?.plain_text || "").trim() || "Database";
  const lastEdited = String(db?.last_edited_time || "").trim();
  return { id: dbId, title, lastEdited };
}

/**
 * @param {any[]} blocks
 * @returns {Promise<any[]>}
 */
export async function hydrateBlocks(blocks) {
  for (const b of blocks) {
    // Avoid hydrating child pages/databases: we only render them as links,
    // and pulling their full subtree makes search noisy + sync slower.
    const t = String(b?.type || "");
    const shouldSkip = t === "child_page" || t === "child_database" || t === "link_to_page";

    if (b?.has_children && !shouldSkip) {
      const kids = await listBlockChildrenCached(b.id);
      b.__children = await hydrateBlocks(kids);
    }
  }
  return blocks;
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
    if (b?.type !== "code") continue;
    const rt = b?.code?.rich_text ?? [];
    const text = rt.map((x) => x?.plain_text ?? "").join("");
    const t = text.trim();
    if (!t.startsWith("{")) continue;
    try {
      JSON.parse(t);
      return { blockId: compactId(b.id), json: t };
    } catch {
      // keep searching
    }
  }

  if (maxDepth <= 0) return null;
  for (const b of blocks) {
    if (!b?.has_children) continue;
    const found = await findFirstJsonCodeBlock(b.id, maxDepth - 1);
    if (found) return found;
  }

  return null;
}

/**
 * @param {string} blockId
 * @param {number} [maxDepth]
 * @returns {Promise<Array<{id: string, title: string}>>}
 */
export async function findChildDatabases(blockId, maxDepth = 4) {
  const out = [];
  const blocks = await listBlockChildrenCached(blockId);
  for (const b of blocks) {
    if (b?.type === "child_database") {
      out.push({ id: compactId(b.id), title: b.child_database?.title ?? "" });
      continue;
    }
  }

  if (maxDepth <= 0) return out;
  for (const b of blocks) {
    if (!b?.has_children) continue;
    out.push(...(await findChildDatabases(b.id, maxDepth - 1)));
  }

  return out;
}

