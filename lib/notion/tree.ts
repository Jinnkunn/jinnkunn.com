import {
  parseNotionBlockArray,
  parseNotionDatabaseInfo,
  parseNotionDatabaseRef,
  parseNotionJsonCodeBlock,
} from "./adapters";
import {
  findChildDatabases as findChildDatabasesRaw,
  findFirstJsonCodeBlock as findFirstJsonCodeBlockRaw,
  getDatabaseInfo as getDatabaseInfoRaw,
  getDatabaseParentPageId as getDatabaseParentPageIdRaw,
  hydrateBlocks as hydrateBlocksRaw,
  listBlockChildrenCached as listBlockChildrenCachedRaw,
} from "./tree.mjs";
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
