const CLEAR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m7 21 9.2-9.2a2 2 0 0 0 0-2.8l-3.2-3.2a2 2 0 0 0-2.8 0L1 15"></path>
    <path d="m13 5 6 6"></path>
    <path d="M22 21H7"></path>
  </svg>
`;

const CLOSE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M18 6 6 18"></path>
    <path d="m6 6 12 12"></path>
  </svg>
`;

const SEARCH_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <path d="m21 21-4.3-4.3"></path>
  </svg>
`;

function renderEmptyActions(
  actions: Array<{ id: string; label: string; hint?: string }>,
): string {
  if (!actions.length) return "";
  return (
    `<div class="notion-search__empty-actions">` +
    actions
      .map((a) => {
        const hint = a.hint
          ? `<span class="notion-search__empty-action-hint">${escapeHtml(a.hint)}</span>`
          : "";
        return (
          `<button class="notion-search__empty-action" type="button" id="${escapeHtml(a.id)}">` +
          `<span class="notion-search__empty-action-label">${escapeHtml(a.label)}</span>` +
          hint +
          `</button>`
        );
      })
      .join("") +
    `</div>`
  );
}

export function searchClearIconSvg(): string {
  return CLEAR_SVG;
}

export function searchCloseIconSvg(): string {
  return CLOSE_SVG;
}

export function buildSearchOverlayHtml(): string {
  return `
    <div class="notion-search__wrapper" role="dialog" aria-modal="true" aria-label="Search">
      <div class="notion-search__box" role="document">
        <div class="notion-search__input">
          <div class="notion-search__icon" aria-hidden="true">
            ${SEARCH_SVG}
          </div>
          <input id="notion-search-input" type="text" inputmode="search" placeholder="Search..." autocomplete="off" spellcheck="false" />
          <button id="notion-search-clear" class="notion-search__clear" type="button" aria-label="Clear query" title="Clear">
            ${CLEAR_SVG}
          </button>
          <button id="notion-search-close" class="notion-search__close" type="button" aria-label="Close search" title="Close">
            ${CLOSE_SVG}
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
}

export function buildSearchEmptyHtml(opts?: {
  title?: string;
  actions?: Array<{ id: string; label: string; hint?: string }>;
}): string {
  const title = String(opts?.title || "No results");
  const actions = Array.isArray(opts?.actions) ? opts.actions : [];
  return (
    `<div class="notion-search__empty-state">` +
    `<div class="notion-search__empty-title">${escapeHtml(title)}</div>` +
    renderEmptyActions(actions) +
    `</div>`
  );
}

export function buildSearchLoaderHtml(): string {
  return `<div class="notion-search__result-loader">Searching...</div>`;
}
import { escapeHtml } from "@/lib/shared/text-utils";

