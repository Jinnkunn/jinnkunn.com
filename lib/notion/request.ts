import type { NotionRequestOptions } from "./types.ts";
import { notionRequest as notionRequestMjs } from "./request.mjs";

// TS facade over the script/runtime .mjs implementation.
// Keeps one source of truth for Notion retry/backoff behavior.
export async function notionRequest<T = unknown>(
  pathname: string,
  opts: NotionRequestOptions = {},
): Promise<T> {
  return notionRequestMjs(pathname, opts) as Promise<T>;
}
