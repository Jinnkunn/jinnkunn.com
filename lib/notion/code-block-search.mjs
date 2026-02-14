import { compactId } from "../shared/route-utils.mjs";
import { listBlockChildrenCached } from "./block-children-cache.mjs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
