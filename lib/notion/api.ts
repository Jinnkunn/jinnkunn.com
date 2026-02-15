import {
  getPropCheckbox as getPropCheckboxRaw,
  getPropNumber as getPropNumberRaw,
  getPropString as getPropStringRaw,
  richTextPlain as richTextPlainRaw,
} from "./properties.mjs";
import { listBlockChildren as listBlockChildrenRaw, queryDatabase as queryDatabaseRaw } from "./paginated.mjs";
import { notionRequest as notionRequestRaw } from "./request.mjs";
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
  const out = await notionRequestRaw(pathname, opts);
  return out as T;
}

export async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const out = await listBlockChildrenRaw(blockId);
  return parseNotionBlockArray(out);
}

export async function queryDatabase(
  databaseId: string,
  opts?: { filter?: unknown; sorts?: unknown },
): Promise<NotionPageLike[]> {
  const out = await queryDatabaseRaw(databaseId, opts);
  return parseNotionPageLikeArray(out);
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
