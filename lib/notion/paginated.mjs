import { compactId } from "../shared/route-utils.mjs";
import { notionRequest } from "./request.mjs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {import("./types.ts").NotionPageLike} NotionPageLike
 */

/**
 * @typedef {import("./types.ts").NotionBlock} NotionBlock
 */

/**
 * @param {string} blockId
 * @returns {Promise<NotionBlock[]>}
 */
export async function listBlockChildren(blockId) {
  /** @type {NotionBlock[]} */
  const out = [];
  /** @type {string | undefined} */
  let cursor;
  const id = compactId(blockId);
  for (;;) {
    const data = await notionRequest(`blocks/${id}/children`, {
      searchParams: cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 },
    });
    const dataObj = isRecord(data) ? data : null;
    const resultsRaw = dataObj && Array.isArray(dataObj.results) ? dataObj.results : [];
    const results = resultsRaw.filter(isRecord);
    out.push(.../** @type {NotionBlock[]} */ (results));
    if (!dataObj || dataObj.has_more !== true) break;
    cursor = typeof dataObj.next_cursor === "string" ? dataObj.next_cursor : undefined;
    if (!cursor) break;
  }
  return out;
}

/**
 * @param {string} databaseId
 * @param {{ filter?: unknown, sorts?: unknown }} [opts]
 * @returns {Promise<NotionPageLike[]>}
 */
export async function queryDatabase(databaseId, opts = {}) {
  /** @type {NotionPageLike[]} */
  const out = [];
  /** @type {string | undefined} */
  let cursor;
  const id = compactId(databaseId);
  for (;;) {
    /** @type {{ page_size: number, start_cursor?: string, filter?: unknown, sorts?: unknown }} */
    const body = { page_size: 100, start_cursor: cursor };
    if (opts.filter !== undefined) body.filter = opts.filter;
    if (opts.sorts !== undefined) body.sorts = opts.sorts;
    const data = await notionRequest(`databases/${id}/query`, { method: "POST", body });
    const dataObj = isRecord(data) ? data : null;
    const resultsRaw = dataObj && Array.isArray(dataObj.results) ? dataObj.results : [];
    const results = resultsRaw.filter(isRecord);
    out.push(.../** @type {NotionPageLike[]} */ (results));
    if (!dataObj || dataObj.has_more !== true) break;
    cursor = typeof dataObj.next_cursor === "string" ? dataObj.next_cursor : undefined;
    if (!cursor) break;
  }
  return out;
}
