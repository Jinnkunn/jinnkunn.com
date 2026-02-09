"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type SearchItem = {
  title: string;
  routePath: string;
  kind: string;
  snippet?: string;
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function ensureSearch(): {
  root: HTMLElement;
  wrapper: HTMLElement;
  box: HTMLElement;
  input: HTMLInputElement;
  clearBtn: HTMLButtonElement;
  list: HTMLElement;
  footer: HTMLElement;
} {
  const existing = document.getElementById("notion-search");
  if (existing) {
    const wrapper = existing.querySelector<HTMLElement>(".notion-search__wrapper");
    const box = existing.querySelector<HTMLElement>(".notion-search__box");
    const input = existing.querySelector<HTMLInputElement>("#notion-search-input");
    const clearBtn = existing.querySelector<HTMLButtonElement>("#notion-search-clear");
    const list = existing.querySelector<HTMLElement>("#notion-search-results");
    const footer = existing.querySelector<HTMLElement>("#notion-search-footer");
    if (wrapper && box && input && clearBtn && list && footer) {
      return { root: existing, wrapper, box, input, clearBtn, list, footer };
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
          <input id="notion-search-input" type="search" placeholder="Search..." autocomplete="off" spellcheck="false" />
          <button id="notion-search-clear" class="notion-search__clear" type="button" aria-label="Clear">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
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
  const list = root.querySelector<HTMLElement>("#notion-search-results")!;
  const footer = root.querySelector<HTMLElement>("#notion-search-footer")!;
  return { root, wrapper, box, input, clearBtn, list, footer };
}

function renderEmpty(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__empty-state">No results</div>`;
}

function renderLoader(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__result-loader">Searching...</div>`;
}

function renderResults(list: HTMLElement, items: SearchItem[]) {
  if (!items.length) return renderEmpty(list);
  list.innerHTML = items
    .map((it, idx) => {
      const last = idx === items.length - 1;
      const title = escapeHtml(it.title || "Untitled");
      const route = escapeHtml(it.routePath || "/");
      const kind = escapeHtml(it.kind || "page");
      const snippet = escapeHtml(it.snippet || "");
      return `
        <div class="notion-search__result-item-wrapper${last ? " last" : ""}">
          <a class="notion-search__result-item ${kind}" href="${route}" role="option" aria-selected="false">
            <div class="notion-search__result-item-content">
              <div class="notion-search__result-item-title">
                <span class="notion-semantic-string">${title}</span>
              </div>
              ${
                snippet
                  ? `<div class="notion-search__result-item-text">${snippet}</div><div class="notion-search__result-item-meta">${route}</div>`
                  : `<div class="notion-search__result-item-text">${route}</div>`
              }
            </div>
            <div class="notion-search__result-item-enter-icon" aria-hidden="true">↵</div>
          </a>
        </div>
      `.trim();
    })
    .join("");
}

async function fetchResults(q: string, signal: AbortSignal): Promise<SearchItem[]> {
  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", q);
  const res = await fetch(url, { signal, headers: { "cache-control": "no-store" } });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as unknown;
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const it: SearchItem = {
        title: String(o.title || ""),
        routePath: String(o.routePath || ""),
        kind: String(o.kind || "page"),
        snippet: String(o.snippet || ""),
      };
      return it;
    })
    .filter((x): x is SearchItem => Boolean(x && x.routePath));
}

export default function SiteSearchBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const trigger = document.getElementById("search-trigger") as HTMLButtonElement | null;
    if (!trigger) return;

    const { root, wrapper, input, clearBtn, list, footer } = ensureSearch();

    let open = false;
    let lastFocus: HTMLElement | null = null;
    let aborter: AbortController | null = null;
    let debounceTimer: number | null = null;

    const setOpen = (next: boolean) => {
      open = next;
      root.classList.toggle("open", open);
      root.classList.toggle("close", !open);
      root.setAttribute("data-open", open ? "true" : "false");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        lastFocus = document.activeElement as HTMLElement | null;
        input.value = "";
        renderEmpty(list);
        footer.innerHTML = `<div class="notion-search__result-footer-shortcut">Esc</div> to close`;
        window.setTimeout(() => input.focus(), 0);
      } else {
        aborter?.abort();
        aborter = null;
        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = null;
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        lastFocus = null;
      }
    };

    const close = () => setOpen(false);

    const onTriggerClick = (e: MouseEvent) => {
      e.preventDefault();
      setOpen(!open);
    };

    const onWrapperClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (t.closest(".notion-search__box")) return;
      close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    const runSearch = (q: string) => {
      const query = q.trim();
      if (!query) {
        aborter?.abort();
        aborter = null;
        renderEmpty(list);
        return;
      }

      aborter?.abort();
      aborter = new AbortController();
      renderLoader(list);

      void (async () => {
        const items = await fetchResults(query, aborter!.signal).catch(() => []);
        if (aborter?.signal.aborted) return;
        renderResults(list, items);
        footer.innerHTML = `<strong>${items.length}</strong> results`;
      })();
    };

    const onInput = () => {
      if (!open) return;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => runSearch(input.value), 140);
    };

    const onClear = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!open) return;
      // Super-like behavior: "X" clears if there is input; otherwise it closes.
      if (!input.value.trim()) {
        close();
        return;
      }
      input.value = "";
      input.focus();
      renderEmpty(list);
      footer.innerHTML = `<div class="notion-search__result-footer-shortcut">Esc</div> to close`;
    };

    trigger.addEventListener("click", onTriggerClick);
    wrapper.addEventListener("click", onWrapperClick);
    document.addEventListener("keydown", onKeyDown, true);
    input.addEventListener("input", onInput);
    clearBtn.addEventListener("click", onClear);

    // Close on navigation.
    if (open) close();

    return () => {
      trigger.removeEventListener("click", onTriggerClick);
      wrapper.removeEventListener("click", onWrapperClick);
      document.removeEventListener("keydown", onKeyDown, true);
      input.removeEventListener("input", onInput);
      clearBtn.removeEventListener("click", onClear);
      aborter?.abort();
      aborter = null;
    };
  }, []);

  useEffect(() => {
    // On route change, close the search if it's open (best-effort).
    const root = document.getElementById("notion-search");
    if (!root) return;
    if (root.classList.contains("open")) {
      root.classList.remove("open");
      root.classList.add("close");
      const trigger = document.getElementById("search-trigger") as HTMLButtonElement | null;
      trigger?.setAttribute("aria-expanded", "false");
    }
  }, [pathname]);

  return null;
}
