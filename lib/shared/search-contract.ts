import {
  emptySearchResponse as emptySearchResponseImpl,
  normalizeSearchKind as normalizeSearchKindImpl,
  parseSearchItem as parseSearchItemImpl,
  parseSearchItems as parseSearchItemsImpl,
  parseSearchMeta as parseSearchMetaImpl,
  parseSearchResponse as parseSearchResponseImpl,
} from "./search-contract.mjs";

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

export const normalizeSearchKind = normalizeSearchKindImpl as (
  value: unknown,
) => SearchKind;

export const parseSearchItem = parseSearchItemImpl as (
  value: unknown,
) => SearchItem | null;

export const parseSearchItems = parseSearchItemsImpl as (
  value: unknown,
) => SearchItem[];

export const parseSearchMeta = parseSearchMetaImpl as (
  value: unknown,
) => SearchMeta | null;

export const parseSearchResponse = parseSearchResponseImpl as (
  value: unknown,
) => SearchResponse;

export const emptySearchResponse = emptySearchResponseImpl as (
  options?: { limit?: number },
) => SearchResponse;
