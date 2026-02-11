import { renderSearchResultsHtml, type SearchItem } from "@/lib/client/site-search-render";

export function ensureSearch(): {
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
} {
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

  root.innerHTML = `
    <div class="notion-search__wrapper" role="dialog" aria-modal="true" aria-label="Search">
      <div class="notion-search__box" role="document">
        <div class="notion-search__input">
          <div class="notion-search__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.3-4.3"></path>
            </svg>
          </div>
          <input id="notion-search-input" type="text" inputmode="search" placeholder="Search..." autocomplete="off" spellcheck="false" />
          <button id="notion-search-clear" class="notion-search__clear" type="button" aria-label="Clear query" title="Clear">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M6 6l1 16h10l1-16"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
          <button id="notion-search-close" class="notion-search__close" type="button" aria-label="Close search" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        </div>
        <div class="notion-search__filters" role="group" aria-label="Search filters">
          <div class="notion-search__filter-pills" role="tablist" aria-label="Type filter">
            <button id="notion-search-filter-all" class="notion-search__pill is-active" type="button" role="tab" aria-selected="true" data-type="all">
              <span class="notion-search__pill-label">All</span><span class="notion-search__pill-count" aria-hidden="true"></span>
            </button>
            <button id="notion-search-filter-pages" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="pages">
              <span class="notion-search__pill-label">Pages</span><span class="notion-search__pill-count" aria-hidden="true"></span>
            </button>
            <button id="notion-search-filter-blog" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="blog">
              <span class="notion-search__pill-label">Blog</span><span class="notion-search__pill-count" aria-hidden="true"></span>
            </button>
            <button id="notion-search-filter-databases" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="databases">
              <span class="notion-search__pill-label">Databases</span><span class="notion-search__pill-count" aria-hidden="true"></span>
            </button>
          </div>
          <button id="notion-search-scope" class="notion-search__pill notion-search__pill--scope" type="button" aria-pressed="false" title="Search only in the current section">This section</button>
        </div>
        <div id="notion-search-results" class="notion-search__result-list" role="listbox" aria-label="Search results"></div>
        <div id="notion-search-footer" class="notion-search__result-footer"></div>
      </div>
    </div>
  `;

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
  const title = String(opts?.title || "No results");
  const actions = Array.isArray(opts?.actions) ? opts!.actions : [];

  const actionsHtml = actions.length
    ? `<div class="notion-search__empty-actions">` +
      actions
        .map((a) => {
          const hint = a.hint ? `<span class="notion-search__empty-action-hint">${a.hint}</span>` : "";
          return (
            `<button class="notion-search__empty-action" type="button" id="${a.id}">` +
              `<span class="notion-search__empty-action-label">${a.label}</span>` +
              hint +
            `</button>`
          );
        })
        .join("") +
      `</div>`
    : "";

  list.innerHTML =
    `<div class="notion-search__empty-state">` +
      `<div class="notion-search__empty-title">${title}</div>` +
      actionsHtml +
    `</div>`;
}

export function renderLoader(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__result-loader">Searching...</div>`;
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
