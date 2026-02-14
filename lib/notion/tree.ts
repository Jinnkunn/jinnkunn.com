import {
  parseNotionBlockArray,
  parseNotionDatabaseInfo,
  parseNotionDatabaseRef,
  parseNotionJsonCodeBlock,
} from "./adapters";
import {
  listBlockChildrenCached as listBlockChildrenCachedRaw,
  findChildDatabases as findChildDatabasesRaw,
} from "./block-children-cache.mjs";
import { findFirstJsonCodeBlock as findFirstJsonCodeBlockRaw } from "./code-block-search.mjs";
import {
  getDatabaseInfo as getDatabaseInfoRaw,
  getDatabaseParentPageId as getDatabaseParentPageIdRaw,
} from "./database-meta.mjs";
import { hydrateBlocks as hydrateBlocksRaw } from "./block-hydration.mjs";
import { readTrimmedString } from "./coerce";
import type {
  NotionBlock,
  NotionDatabaseInfo,
  NotionDatabaseRef,
  NotionJsonCodeBlock,
} from "./types";

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
  const out = await getDatabaseParentPageIdRaw(databaseId);
  return readTrimmedString(out);
}

export async function getDatabaseInfo(databaseId: string): Promise<NotionDatabaseInfo> {
  const out = await getDatabaseInfoRaw(databaseId);
  return parseNotionDatabaseInfo(out);
}

export async function hydrateBlocks(blocks: NotionBlock[]): Promise<NotionBlock[]> {
  const out = await hydrateBlocksRaw(Array.isArray(blocks) ? blocks : []);
  return parseNotionBlockArray(out);
}

export async function findFirstJsonCodeBlock(
  blockId: string,
  maxDepth?: number,
): Promise<NotionJsonCodeBlock | null> {
  const out = await findFirstJsonCodeBlockRaw(blockId, maxDepth);
  return parseNotionJsonCodeBlock(out);
}

export async function findChildDatabases(
  blockId: string,
  maxDepth?: number,
): Promise<NotionDatabaseRef[]> {
  const out = await findChildDatabasesRaw(blockId, maxDepth);
  if (!Array.isArray(out)) return [];
  return out
    .map(parseNotionDatabaseRef)
    .filter((it): it is NotionDatabaseRef => Boolean(it));
}
