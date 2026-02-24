import { slugify } from "../shared/route-utils.ts";
import { findChildDatabases as findChildDatabasesRaw } from "./block-children-cache.ts";
import type { NotionDatabaseRef } from "./types.ts";

export async function findChildDatabases(
  blockId: string,
  maxDepth?: number,
): Promise<NotionDatabaseRef[]> {
  return await findChildDatabasesRaw(blockId, maxDepth);
}

export function findDbByTitle(
  dbs: NotionDatabaseRef[],
  title: string,
): NotionDatabaseRef | null {
  const want = slugify(title);
  return dbs.find((d) => slugify(d.title) === want) || null;
}
