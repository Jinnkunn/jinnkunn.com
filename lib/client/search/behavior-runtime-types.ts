import type { SearchMeta, SearchType } from "@/lib/client/search/types";
import type { SearchItem } from "@/lib/shared/search-contract";

export type SearchRootElement = HTMLElement & {
  __closeSearch?: () => void;
  __emptySwitchType?: SearchType;
};

export type SearchRuntimeState = {
  open: boolean;
  lastFocus: HTMLElement | null;
  aborter: AbortController | null;
  debounceTimer: number | null;
  activeIndex: number;
  unlockScroll: null | (() => void);
  filterType: SearchType;
  scopeEnabled: boolean;
  scopePrefix: string;
  scopeLabel: string;
  lastMeta: SearchMeta | null;
  currentQuery: string;
  currentItems: SearchItem[];
  collapsedGroups: Set<string>;
};

const SEARCH_TYPE_VALUES: readonly SearchType[] = ["all", "pages", "blog", "databases"];

export function parseSearchType(value: unknown): SearchType {
  const v = String(value || "").trim();
  return SEARCH_TYPE_VALUES.includes(v as SearchType) ? (v as SearchType) : "all";
}

export function parseEmptySwitchType(value: unknown): SearchType | undefined {
  const t = parseSearchType(value);
  return t === "all" ? undefined : t;
}
