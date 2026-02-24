import { compactId } from "../shared/route-utils.ts";
import { listBlockChildrenCached } from "./block-children-cache.ts";
import { isRecord } from "./coerce.ts";
import { parseNotionJsonCodeBlock } from "./adapters.ts";
import type { NotionJsonCodeBlock } from "./types.ts";

export async function findFirstJsonCodeBlock(
  blockId: string,
  maxDepth = 4,
): Promise<NotionJsonCodeBlock | null> {
  const blocks = await listBlockChildrenCached(blockId);
  for (const block of blocks) {
    if (block.type !== "code") continue;
    const rt = Array.isArray(block.code?.rich_text) ? block.code.rich_text : [];
    const text = rt.map((item) => (isRecord(item) ? String(item.plain_text ?? "") : "")).join("");
    const jsonText = text.trim();
    if (!jsonText.startsWith("{")) continue;
    try {
      JSON.parse(jsonText);
      return parseNotionJsonCodeBlock({
        blockId: compactId(String(block.id || "")),
        json: jsonText,
      });
    } catch {
      // keep searching
    }
  }

  if (maxDepth <= 0) return null;
  for (const block of blocks) {
    if (!block.has_children) continue;
    const found = await findFirstJsonCodeBlock(String(block.id || ""), maxDepth - 1);
    if (found) return found;
  }
  return null;
}
