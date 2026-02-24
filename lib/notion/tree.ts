import {
  parseNotionBlockArray,
} from "./adapters.ts";
import {
  findChildDatabases as findChildDatabasesRaw,
  listBlockChildrenCached as listBlockChildrenCachedRaw,
} from "./block-children-cache.ts";
import { findFirstJsonCodeBlock as findFirstJsonCodeBlockRaw } from "./code-block-search.ts";
import {
  getDatabaseInfo as getDatabaseInfoRaw,
  getDatabaseParentPageId as getDatabaseParentPageIdRaw,
} from "./database-meta.ts";
import { hydrateBlocks as hydrateBlocksRaw } from "./block-hydration.ts";
import type {
  NotionBlock,
  NotionDatabaseInfo,
  NotionDatabaseRef,
  NotionJsonCodeBlock,
} from "./types.ts";

export type {
  NotionDatabaseInfo,
  NotionDatabaseRef,
  NotionJsonCodeBlock,
} from "./types";

export async function listBlockChildrenCached(blockId: string): Promise<NotionBlock[]> {
  const out = await listBlockChildrenCachedRaw(blockId);
  return parseNotionBlockArray(out);
}

export async function getDatabaseParentPageId(databaseId: string): Promise<string> {
  return await getDatabaseParentPageIdRaw(databaseId);
}

export async function getDatabaseInfo(databaseId: string): Promise<NotionDatabaseInfo> {
  return await getDatabaseInfoRaw(databaseId);
}

export async function hydrateBlocks(blocks: NotionBlock[]): Promise<NotionBlock[]> {
  const out = await hydrateBlocksRaw(Array.isArray(blocks) ? blocks : []);
  return parseNotionBlockArray(out);
}

export async function findFirstJsonCodeBlock(
  blockId: string,
  maxDepth?: number,
): Promise<NotionJsonCodeBlock | null> {
  return await findFirstJsonCodeBlockRaw(blockId, maxDepth);
}

export async function findChildDatabases(
  blockId: string,
  maxDepth?: number,
): Promise<NotionDatabaseRef[]> {
  return await findChildDatabasesRaw(blockId, maxDepth);
}
