export type SearchType = "all" | "pages" | "blog" | "databases";

export type SearchMeta = {
  total: number;
  filteredTotal: number;
  counts: { all: number; pages: number; blog: number; databases: number };
  groups?: Array<{ label: string; count: number }>;
  offset: number;
  limit: number;
  hasMore: boolean;
};

