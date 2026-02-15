import { asRecordArray, isRecord, readTrimmedString } from "./coerce.ts";
import type {
  NotionBlock,
  NotionDatabaseInfo,
  NotionDatabaseRef,
  NotionJsonCodeBlock,
  NotionPageMeta,
  NotionPageLike,
} from "./types.ts";

export function parseNotionBlockArray(value: unknown): NotionBlock[] {
  return asRecordArray(value) as NotionBlock[];
}

export function parseNotionPageLikeArray(value: unknown): NotionPageLike[] {
  return asRecordArray(value) as NotionPageLike[];
}

export function parseNotionTitleFromProperties(properties: unknown): string {
  if (!isRecord(properties)) return "";
  for (const prop of Object.values(properties)) {
    if (!isRecord(prop)) continue;
    if (readTrimmedString(prop.type) !== "title") continue;
    const title = asRecordArray(prop.title)
      .map((x) => readTrimmedString(x.plain_text))
      .join("")
      .trim();
    if (title) return title;
  }
  return "";
}

export function parseNotionPageMeta(
  value: unknown,
  opts?: { fallbackId?: string; fallbackTitle?: string },
): NotionPageMeta | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id) || readTrimmedString(opts?.fallbackId);
  if (!id) return null;
  const title =
    parseNotionTitleFromProperties(value.properties) ||
    readTrimmedString(opts?.fallbackTitle) ||
    "Untitled";
  const lastEdited = readTrimmedString(value.last_edited_time);
  return { id, title, lastEdited };
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
