export type SearchKind = "page" | "blog" | "database";

export type SearchItem = {
  title: string;
  routePath: string;
  kind: SearchKind;
  snippet?: string;
  breadcrumb?: string;
};

export type SearchGroupCount = {
  label: string;
  count: number;
};

export type SearchMeta = {
  total: number;
  filteredTotal: number;
  counts: {
    all: number;
    pages: number;
    blog: number;
    databases: number;
  };
  groups?: SearchGroupCount[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type SearchResponse = {
  items: SearchItem[];
  meta: SearchMeta | null;
};

const SEARCH_KIND_SET = new Set<SearchKind>(["page", "blog", "database"]);

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toStringTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeSearchKind(value: unknown): SearchKind {
  const raw = toStringTrimmed(value).toLowerCase();
  return SEARCH_KIND_SET.has(raw as SearchKind) ? (raw as SearchKind) : "page";
}

export function parseSearchItem(value: unknown): SearchItem | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const routePath = toStringTrimmed(o.routePath || "/") || "/";
  if (!routePath.startsWith("/")) return null;

  const title = toStringTrimmed(o.title) || "Untitled";
  const snippet = toStringTrimmed(o.snippet);
  const breadcrumb = toStringTrimmed(o.breadcrumb);

  return {
    title,
    routePath,
    kind: normalizeSearchKind(o.kind),
    snippet,
    breadcrumb,
  };
}

export function parseSearchItems(value: unknown): SearchItem[] {
  const arr = Array.isArray(value) ? value : [];
  return arr.map(parseSearchItem).filter((item): item is SearchItem => Boolean(item));
}

export function parseSearchMeta(value: unknown): SearchMeta | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  const counts0 = m.counts;
  const countsObj =
    counts0 && typeof counts0 === "object" ? (counts0 as Record<string, unknown>) : null;

  const all = toFiniteNumber(countsObj?.all);
  const pages = toFiniteNumber(countsObj?.pages);
  const blog = toFiniteNumber(countsObj?.blog);
  const databases = toFiniteNumber(countsObj?.databases);

  const total = toFiniteNumber(m.total);
  const filteredTotal = toFiniteNumber(m.filteredTotal);
  const offset = toFiniteNumber(m.offset);
  const limit = toFiniteNumber(m.limit);
  const hasMore = Boolean(m.hasMore);

  if (![all, pages, blog, databases, total, filteredTotal, offset, limit].every(Number.isFinite)) {
    return null;
  }

  const groups0 = m.groups;
  const groups = Array.isArray(groups0)
    ? groups0
        .map((g) => {
          if (!g || typeof g !== "object") return null;
          const gg = g as Record<string, unknown>;
          const label = toStringTrimmed(gg.label);
          const count = toFiniteNumber(gg.count);
          if (!label || !Number.isFinite(count)) return null;
          return { label, count };
        })
        .filter((g): g is SearchGroupCount => Boolean(g))
    : undefined;

  return {
    total,
    filteredTotal,
    counts: { all, pages, blog, databases },
    groups,
    offset,
    limit,
    hasMore,
  };
}

export function parseSearchResponse(value: unknown): SearchResponse {
  if (!value || typeof value !== "object") return { items: [], meta: null };
  const o = value as { items?: unknown; meta?: unknown };
  return {
    items: parseSearchItems(o.items),
    meta: parseSearchMeta(o.meta),
  };
}

export function emptySearchResponse(options?: { limit?: number }): SearchResponse {
  const limit = Number(options?.limit);
  return {
    items: [],
    meta: {
      total: 0,
      filteredTotal: 0,
      counts: { all: 0, pages: 0, blog: 0, databases: 0 },
      offset: 0,
      limit: Number.isFinite(limit) ? limit : 20,
      hasMore: false,
    },
  };
}
