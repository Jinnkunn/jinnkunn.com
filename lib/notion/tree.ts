import {
  findChildDatabases as findChildDatabasesRaw,
  findFirstJsonCodeBlock as findFirstJsonCodeBlockRaw,
  getDatabaseInfo as getDatabaseInfoRaw,
  getDatabaseParentPageId as getDatabaseParentPageIdRaw,
  hydrateBlocks as hydrateBlocksRaw,
  listBlockChildrenCached as listBlockChildrenCachedRaw,
} from "./tree.mjs";
import { asRecordArray, isRecord, readTrimmedString } from "./coerce";
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

function asBlockArray(value: unknown): NotionBlock[] {
  return asRecordArray(value) as NotionBlock[];
}

function asDatabaseRef(value: unknown): NotionDatabaseRef | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id);
  if (!id) return null;
  return {
    id,
    title: readTrimmedString(value.title),
  };
}

export async function listBlockChildrenCached(blockId: string): Promise<NotionBlock[]> {
  const out = await listBlockChildrenCachedRaw(blockId);
  return asBlockArray(out);
}

export async function getDatabaseParentPageId(databaseId: string): Promise<string> {
  const out = await getDatabaseParentPageIdRaw(databaseId);
  return readTrimmedString(out);
}

export async function getDatabaseInfo(databaseId: string): Promise<NotionDatabaseInfo> {
  const out = await getDatabaseInfoRaw(databaseId);
  if (!isRecord(out)) return { id: "", title: "Database", lastEdited: "" };
  return {
    id: readTrimmedString(out.id),
    title: readTrimmedString(out.title) || "Database",
    lastEdited: readTrimmedString(out.lastEdited),
  };
}

export async function hydrateBlocks(blocks: NotionBlock[]): Promise<NotionBlock[]> {
  const out = await hydrateBlocksRaw(Array.isArray(blocks) ? blocks : []);
  return asBlockArray(out);
}

export async function findFirstJsonCodeBlock(
  blockId: string,
  maxDepth?: number,
): Promise<NotionJsonCodeBlock | null> {
  const out = await findFirstJsonCodeBlockRaw(blockId, maxDepth);
  if (!isRecord(out)) return null;
  const block = {
    blockId: readTrimmedString(out.blockId),
    json: typeof out.json === "string" ? out.json : "",
  };
  return block.blockId && block.json ? block : null;
}

export async function findChildDatabases(
  blockId: string,
  maxDepth?: number,
): Promise<NotionDatabaseRef[]> {
  const out = await findChildDatabasesRaw(blockId, maxDepth);
  if (!Array.isArray(out)) return [];
  return out.map(asDatabaseRef).filter((it): it is NotionDatabaseRef => Boolean(it));
}
