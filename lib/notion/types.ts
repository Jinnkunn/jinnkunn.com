export type NotionRequestOptions = {
  method?: string;
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | null | undefined>;
  token?: string;
  version?: string;
  maxRetries?: number;
};

export type NotionRichTextItem = {
  plain_text?: string;
};

export type NotionProperty =
  | { type: "title"; title?: NotionRichTextItem[] }
  | { type: "rich_text"; rich_text?: NotionRichTextItem[] }
  | { type: "select"; select?: { name?: string | null } | null }
  | { type: "url"; url?: string | null }
  | { type: "number"; number?: number | null }
  | { type: "checkbox"; checkbox?: boolean | null }
  | { type: string; [key: string]: unknown };

export type NotionPageLike = {
  properties?: Record<string, NotionProperty>;
  id?: string;
  [key: string]: unknown;
};

export type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  __children?: NotionBlock[];
  code?: { rich_text?: NotionRichTextItem[] };
  child_database?: { title?: string };
  [key: string]: unknown;
};

export type NotionDatabaseRef = { id: string; title: string };
export type NotionDatabaseInfo = { id: string; title: string; lastEdited: string };
export type NotionJsonCodeBlock = { blockId: string; json: string };
