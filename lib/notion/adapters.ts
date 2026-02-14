import { asRecordArray, isRecord, readTrimmedString } from "./coerce.ts";
import type {
  NotionBlock,
  NotionDatabaseInfo,
  NotionDatabaseRef,
  NotionJsonCodeBlock,
  NotionPageLike,
} from "./types.ts";

export function parseNotionBlockArray(value: unknown): NotionBlock[] {
  return asRecordArray(value) as NotionBlock[];
}

export function parseNotionPageLikeArray(value: unknown): NotionPageLike[] {
  return asRecordArray(value) as NotionPageLike[];
}

export function parseNotionDatabaseRef(value: unknown): NotionDatabaseRef | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id);
  if (!id) return null;
  return {
    id,
    title: readTrimmedString(value.title),
  };
}

export function parseNotionDatabaseInfo(value: unknown): NotionDatabaseInfo {
  if (!isRecord(value)) return { id: "", title: "Database", lastEdited: "" };
  return {
    id: readTrimmedString(value.id),
    title: readTrimmedString(value.title) || "Database",
    lastEdited: readTrimmedString(value.lastEdited),
  };
}

export function parseNotionJsonCodeBlock(value: unknown): NotionJsonCodeBlock | null {
  if (!isRecord(value)) return null;
  const blockId = readTrimmedString(value.blockId);
  const json = typeof value.json === "string" ? value.json : "";
  return blockId && json ? { blockId, json } : null;
}
