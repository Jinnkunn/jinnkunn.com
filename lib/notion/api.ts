import {
  parseNotionBlockArray,
  parseNotionPageLikeArray,
} from "./adapters.ts";
import {
  readBoolean,
  readNumber,
  readTrimmedString,
} from "./coerce.ts";
import type {
  NotionBlock,
  NotionPageLike,
  NotionRequestOptions,
  NotionRichTextItem,
} from "./types.ts";
import {
  getPropCheckbox as getPropCheckboxSafe,
  getPropNumber as getPropNumberSafe,
  getPropString as getPropStringSafe,
  richTextPlain as richTextPlainSafe,
} from "./properties.ts";
import {
  listBlockChildren as listBlockChildrenSafe,
  queryDatabase as queryDatabaseSafe,
} from "./paginated.ts";
import { notionRequest as notionRequestSafe } from "./request.ts";

export type {
  NotionBlock,
  NotionPageLike,
  NotionRequestOptions,
  NotionRichTextItem,
  NotionProperty,
} from "./types.ts";

export async function notionRequest<T = unknown>(
  pathname: string,
  opts?: NotionRequestOptions,
): Promise<T> {
  const out = await notionRequestSafe(pathname, opts);
  return out as T;
}

export async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const out = await listBlockChildrenSafe(blockId);
  return parseNotionBlockArray(out);
}

export async function queryDatabase(
  databaseId: string,
  opts?: { filter?: unknown; sorts?: unknown },
): Promise<NotionPageLike[]> {
  const out = await queryDatabaseSafe(databaseId, opts);
  return parseNotionPageLikeArray(out);
}

export function richTextPlain(rt: NotionRichTextItem[] | undefined | null): string {
  const out = richTextPlainSafe(rt);
  return readTrimmedString(out);
}

export function getPropString(
  page: NotionPageLike | null | undefined,
  name: string,
): string {
  const out = getPropStringSafe(page, name);
  return readTrimmedString(out);
}

export function getPropNumber(
  page: NotionPageLike | null | undefined,
  name: string,
): number | null {
  const out = getPropNumberSafe(page, name);
  return readNumber(out);
}

export function getPropCheckbox(
  page: NotionPageLike | null | undefined,
  name: string,
): boolean | null {
  const out = getPropCheckboxSafe(page, name);
  return readBoolean(out);
}
