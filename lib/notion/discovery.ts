import {
  findDbByTitle as findDbByTitleRaw,
} from "./discovery.mjs";
import { findChildDatabases as findChildDatabasesRaw } from "./block-children-cache.mjs";
import { parseNotionDatabaseRef } from "./adapters";
import type { NotionDatabaseRef } from "./types";

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

export function findDbByTitle(
  dbs: NotionDatabaseRef[],
  title: string,
): NotionDatabaseRef | null {
  const out = findDbByTitleRaw(dbs, title);
  return parseNotionDatabaseRef(out);
}
