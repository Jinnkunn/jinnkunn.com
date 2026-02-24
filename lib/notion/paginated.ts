import { compactId } from "../shared/route-utils.ts";
import { asRecordArray, isRecord, readTrimmedString } from "./coerce.ts";
import { notionRequest } from "./request.ts";
import type { NotionBlock, NotionPageLike } from "./types.ts";

type PaginatedResponse = {
  results?: unknown;
  has_more?: unknown;
  next_cursor?: unknown;
};

function nextCursorFromResponse(data: PaginatedResponse): string {
  return readTrimmedString(data.next_cursor);
}

export async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor = "";
  const id = compactId(blockId);
  if (!id) return out;

  for (;;) {
    const searchParams = cursor
      ? { start_cursor: cursor, page_size: 100 }
      : { page_size: 100 };
    const data = await notionRequest<PaginatedResponse>(`blocks/${id}/children`, {
      searchParams,
    });
    const dataObj = isRecord(data) ? (data as PaginatedResponse) : null;
    const results = asRecordArray(dataObj?.results);
    out.push(...(results as NotionBlock[]));
    if (!dataObj || dataObj.has_more !== true) break;
    cursor = nextCursorFromResponse(dataObj);
    if (!cursor) break;
  }

  return out;
}

export async function queryDatabase(
  databaseId: string,
  opts: { filter?: unknown; sorts?: unknown } = {},
): Promise<NotionPageLike[]> {
  const out: NotionPageLike[] = [];
  let cursor = "";
  const id = compactId(databaseId);
  if (!id) return out;

  for (;;) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (opts.filter !== undefined) body.filter = opts.filter;
    if (opts.sorts !== undefined) body.sorts = opts.sorts;

    const data = await notionRequest<PaginatedResponse>(`databases/${id}/query`, {
      method: "POST",
      body,
    });
    const dataObj = isRecord(data) ? (data as PaginatedResponse) : null;
    const results = asRecordArray(dataObj?.results);
    out.push(...(results as NotionPageLike[]));
    if (!dataObj || dataObj.has_more !== true) break;
    cursor = nextCursorFromResponse(dataObj);
    if (!cursor) break;
  }

  return out;
}
