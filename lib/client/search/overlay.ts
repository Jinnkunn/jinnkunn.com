import { setInert } from "@/lib/client/dom-utils";
import { renderSearchResultsHtml } from "@/lib/client/site-search-render";
import type { SearchItem } from "@/lib/shared/search-contract";
import {
  buildSearchEmptyHtml,
  buildSearchLoaderHtml,
  buildSearchOverlayHtml,
  searchClearIconSvg,
  searchCloseIconSvg,
} from "@/lib/client/search/overlay-template";

// The result list renders an "empty" body in three situations that read very differently to
// the user: before anything has been typed, after a query legitimately matched nothing, and
// after the request itself never landed. Only the middle one is the template default
// ("No results"), so the idle and error call sites pass their own title.
export const SEARCH_EMPTY_IDLE_TITLE = "Type to search";
export const SEARCH_EMPTY_ERROR_TITLE = "Search is unavailable";
export const SEARCH_RETRY_ACTION_ID = "notion-search-retry";

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
      // Same for `inert`: an overlay left over from a build that predates it would otherwise
      // stay tabbable until the first open/close cycle.
      setInert(existing, existing.getAttribute("data-open") !== "true");

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

  // The overlay is appended to <body> on every public page and is only *visually* hidden
  // (opacity + pointer-events). Without `inert` its input, filter pills and close button stay
  // at the end of the tab order and its role="dialog" stays in the accessibility tree on every
  // page. It is created closed; `setOpen` flips this on each toggle.
  setInert(root, true);

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
