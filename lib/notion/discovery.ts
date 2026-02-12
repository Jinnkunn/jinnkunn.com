import {
  findChildDatabases as findChildDatabasesRaw,
  findDbByTitle as findDbByTitleRaw,
} from "./discovery.mjs";
import { readStringField } from "./coerce";
import type { NotionDatabaseRef } from "./types";

function toDatabaseRef(value: unknown): NotionDatabaseRef | null {
  const id = readStringField(value, "id");
  if (!id) return null;
  return {
    id,
    title: readStringField(value, "title"),
  };
}

export async function findChildDatabases(
  blockId: string,
  maxDepth?: number,
): Promise<NotionDatabaseRef[]> {
  const out = await findChildDatabasesRaw(blockId, maxDepth);
  if (!Array.isArray(out)) return [];
  return out.map(toDatabaseRef).filter((it): it is NotionDatabaseRef => Boolean(it));
}

export function findDbByTitle(
  dbs: NotionDatabaseRef[],
  title: string,
): NotionDatabaseRef | null {
  const out = findDbByTitleRaw(dbs, title);
  return toDatabaseRef(out);
}
