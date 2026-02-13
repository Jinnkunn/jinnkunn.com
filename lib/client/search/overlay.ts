import { renderSearchResultsHtml } from "@/lib/client/site-search-render";
import type { SearchItem } from "@/lib/shared/search-contract";
import {
  buildSearchEmptyHtml,
  buildSearchLoaderHtml,
  buildSearchOverlayHtml,
  searchClearIconSvg,
  searchCloseIconSvg,
} from "@/lib/client/search/overlay-template";

export type SearchOverlayElements = {
  root: HTMLElement;
  wrapper: HTMLElement;
  box: HTMLElement;
  input: HTMLInputElement;
  clearBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  filterAll: HTMLButtonElement;
  filterPages: HTMLButtonElement;
  filterBlog: HTMLButtonElement;
  filterDatabases: HTMLButtonElement;
  scopeBtn: HTMLButtonElement;
  list: HTMLElement;
  footer: HTMLElement;
};

export function ensureSearch(): SearchOverlayElements {
  const existing = document.getElementById("notion-search");
  if (existing) {
    const wrapper = existing.querySelector<HTMLElement>(".notion-search__wrapper");
    const box = existing.querySelector<HTMLElement>(".notion-search__box");
    const input = existing.querySelector<HTMLInputElement>("#notion-search-input");
    const clearBtn = existing.querySelector<HTMLButtonElement>("#notion-search-clear");
    const closeBtn = existing.querySelector<HTMLButtonElement>("#notion-search-close");
    const filterAll = existing.querySelector<HTMLButtonElement>("#notion-search-filter-all");
    const filterPages = existing.querySelector<HTMLButtonElement>("#notion-search-filter-pages");
    const filterBlog = existing.querySelector<HTMLButtonElement>("#notion-search-filter-blog");
    const filterDatabases = existing.querySelector<HTMLButtonElement>("#notion-search-filter-databases");
    const scopeBtn = existing.querySelector<HTMLButtonElement>("#notion-search-scope");
    const list = existing.querySelector<HTMLElement>("#notion-search-results");
    const footer = existing.querySelector<HTMLElement>("#notion-search-footer");
    if (
      wrapper &&
      box &&
      input &&
      clearBtn &&
      closeBtn &&
      filterAll &&
      filterPages &&
      filterBlog &&
      filterDatabases &&
      scopeBtn &&
      list &&
      footer
    ) {
      // Ensure a consistent icon set even if the overlay was created by a previous deploy
      // and persisted via client-side navigation.
      clearBtn.innerHTML = searchClearIconSvg();
      closeBtn.innerHTML = searchCloseIconSvg();

      return {
        root: existing,
        wrapper,
        box,
        input,
        clearBtn,
        closeBtn,
        filterAll,
        filterPages,
        filterBlog,
        filterDatabases,
        scopeBtn,
        list,
        footer,
      };
    }
  }

  const root = document.createElement("div");
  root.id = "notion-search";
  root.className = "notion-search close";

  root.innerHTML = buildSearchOverlayHtml();

  document.body.appendChild(root);

  const wrapper = root.querySelector<HTMLElement>(".notion-search__wrapper")!;
  const box = root.querySelector<HTMLElement>(".notion-search__box")!;
  const input = root.querySelector<HTMLInputElement>("#notion-search-input")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#notion-search-clear")!;
  const closeBtn = root.querySelector<HTMLButtonElement>("#notion-search-close")!;
  const filterAll = root.querySelector<HTMLButtonElement>("#notion-search-filter-all")!;
  const filterPages = root.querySelector<HTMLButtonElement>("#notion-search-filter-pages")!;
  const filterBlog = root.querySelector<HTMLButtonElement>("#notion-search-filter-blog")!;
  const filterDatabases = root.querySelector<HTMLButtonElement>("#notion-search-filter-databases")!;
  const scopeBtn = root.querySelector<HTMLButtonElement>("#notion-search-scope")!;
  const list = root.querySelector<HTMLElement>("#notion-search-results")!;
  const footer = root.querySelector<HTMLElement>("#notion-search-footer")!;

  return {
    root,
    wrapper,
    box,
    input,
    clearBtn,
    closeBtn,
    filterAll,
    filterPages,
    filterBlog,
    filterDatabases,
    scopeBtn,
    list,
    footer,
  };
}

export function renderEmpty(
  list: HTMLElement,
  opts?: {
    title?: string;
    actions?: Array<{ id: string; label: string; hint?: string }>;
  },
) {
  list.innerHTML = buildSearchEmptyHtml(opts);
}

export function renderLoader(list: HTMLElement) {
  list.innerHTML = buildSearchLoaderHtml();
}

export function renderResults(
  list: HTMLElement,
  items: SearchItem[],
  query: string,
  opts?: {
    collapsedGroups?: Set<string>;
    showMore?: boolean;
    remaining?: number;
    groupCounts?: Record<string, number>;
  },
) {
  if (!items.length) return renderEmpty(list);
  list.innerHTML = renderSearchResultsHtml(items, query, opts);
}
