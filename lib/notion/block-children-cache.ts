import { compactId } from "../shared/route-utils.ts";
import { parseNotionBlockArray, parseNotionDatabaseRef } from "./adapters.ts";
import { listBlockChildren } from "./api.ts";
import type { NotionBlock, NotionDatabaseRef } from "./types.ts";

const blockChildrenCache = new Map<string, NotionBlock[]>();

export async function listBlockChildrenCached(blockId: string): Promise<NotionBlock[]> {
  const key = compactId(blockId) || String(blockId || "").trim();
  if (!key) return [];
  const cached = blockChildrenCache.get(key);
  if (cached) return cached;
  const kids = parseNotionBlockArray(await listBlockChildren(key));
  blockChildrenCache.set(key, kids);
  return blockChildrenCache.get(key) || [];
}

export async function findChildDatabases(
  blockId: string,
  maxDepth = 4,
): Promise<NotionDatabaseRef[]> {
  const out: NotionDatabaseRef[] = [];
  const blocks = await listBlockChildrenCached(blockId);
  for (const block of blocks) {
    if (block.type !== "child_database") continue;
    const parsed = parseNotionDatabaseRef({
      id: compactId(String(block.id || "")),
      title: String(block.child_database?.title || ""),
    });
    if (parsed) out.push(parsed);
  }

  if (maxDepth <= 0) return out;
  for (const block of blocks) {
    if (!block.has_children) continue;
    out.push(...(await findChildDatabases(String(block.id || ""), maxDepth - 1)));
  }
  return out;
}
