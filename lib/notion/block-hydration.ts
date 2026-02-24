import { listBlockChildrenCached } from "./block-children-cache.ts";
import { isRecord } from "./coerce.ts";
import type { NotionBlock } from "./types.ts";

export async function hydrateBlocks(blocks: NotionBlock[]): Promise<NotionBlock[]> {
  const out = Array.isArray(blocks) ? blocks : [];
  for (const block of out) {
    if (!isRecord(block)) continue;
    const type = String(block.type || "");
    const shouldSkip = type === "child_page" || type === "child_database" || type === "link_to_page";
    if (!block.has_children || shouldSkip) continue;

    const children = await listBlockChildrenCached(String(block.id || ""));
    block.__children = await hydrateBlocks(children);
  }
  return out;
}
