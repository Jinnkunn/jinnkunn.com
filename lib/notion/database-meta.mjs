import { compactId } from "../shared/route-utils.mjs";
import { notionRequest } from "./api.mjs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
