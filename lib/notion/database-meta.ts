import { compactId } from "../shared/route-utils.ts";
import { parseNotionDatabaseInfo } from "./adapters.ts";
import { notionRequest } from "./api.ts";
import { isRecord, readTrimmedString } from "./coerce.ts";
import type { NotionDatabaseInfo } from "./types.ts";

const dbParentPageCache = new Map<string, string>();

export async function getDatabaseParentPageId(databaseId: string): Promise<string> {
  const dbId = compactId(databaseId);
  if (!dbId) return "";
  const cached = dbParentPageCache.get(dbId);
  if (cached !== undefined) return cached;

  const db = await notionRequest<unknown>(`databases/${dbId}`);
  const parent = isRecord(db) && isRecord(db.parent) ? db.parent : null;
  const parentPageId =
    parent && parent.type === "page_id" ? compactId(readTrimmedString(parent.page_id)) : "";
  dbParentPageCache.set(dbId, parentPageId);
  return parentPageId;
}

export async function getDatabaseInfo(databaseId: string): Promise<NotionDatabaseInfo> {
  const dbId = compactId(databaseId);
  if (!dbId) return { id: "", title: "Database", lastEdited: "" };
  const db = await notionRequest<unknown>(`databases/${dbId}`);
  return parseNotionDatabaseInfo(db);
}
