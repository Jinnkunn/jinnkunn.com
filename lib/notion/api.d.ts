export type NotionRequestOptions = {
  method?: string;
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | null | undefined>;
  token?: string;
  version?: string;
  maxRetries?: number;
};

export function notionRequest(pathname: string, opts?: NotionRequestOptions): Promise<any>;
export function listBlockChildren(blockId: string): Promise<any[]>;
export function queryDatabase(
  databaseId: string,
  opts?: { filter?: unknown; sorts?: unknown },
): Promise<any[]>;

export function richTextPlain(rt: any[] | undefined | null): string;
export function getPropString(page: any, name: string): string;
export function getPropNumber(page: any, name: string): number | null;
export function getPropCheckbox(page: any, name: string): boolean | null;

