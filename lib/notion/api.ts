import {
  getPropCheckbox as getPropCheckboxRaw,
  getPropNumber as getPropNumberRaw,
  getPropString as getPropStringRaw,
  listBlockChildren as listBlockChildrenRaw,
  notionRequest as notionRequestRaw,
  queryDatabase as queryDatabaseRaw,
  richTextPlain as richTextPlainRaw,
} from "./api.mjs";
import {
  asRecordArray,
  readBoolean,
  readNumber,
  readTrimmedString,
} from "./coerce";
import type {
  NotionBlock,
  NotionPageLike,
  NotionRequestOptions,
  NotionRichTextItem,
  NotionProperty,
} from "./types";

export type {
  NotionBlock,
  NotionPageLike,
  NotionRequestOptions,
  NotionRichTextItem,
  NotionProperty,
} from "./types";

export async function notionRequest<T = unknown>(
  pathname: string,
  opts?: NotionRequestOptions,
): Promise<T> {
  const out = await notionRequestRaw(pathname, opts);
  return out as T;
}

export async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const out = await listBlockChildrenRaw(blockId);
  return asRecordArray(out) as NotionBlock[];
}

export async function queryDatabase(
  databaseId: string,
  opts?: { filter?: unknown; sorts?: unknown },
): Promise<NotionPageLike[]> {
  const out = await queryDatabaseRaw(databaseId, opts);
  return asRecordArray(out) as NotionPageLike[];
}

export function richTextPlain(rt: NotionRichTextItem[] | undefined | null): string {
  const out = richTextPlainRaw(rt);
  return readTrimmedString(out);
}

export function getPropString(
  page: NotionPageLike | null | undefined,
  name: string,
): string {
  const out = getPropStringRaw(page, name);
  return readTrimmedString(out);
}

export function getPropNumber(
  page: NotionPageLike | null | undefined,
  name: string,
): number | null {
  const out = getPropNumberRaw(page, name);
  return readNumber(out);
}

export function getPropCheckbox(
  page: NotionPageLike | null | undefined,
  name: string,
): boolean | null {
  const out = getPropCheckboxRaw(page, name);
  return readBoolean(out);
}
