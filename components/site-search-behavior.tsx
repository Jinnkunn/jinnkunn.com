"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { escapeHtml, tokenizeQuery } from "@/lib/shared/text-utils";

type SearchItem = {
  title: string;
  routePath: string;
  kind: string;
  snippet?: string;
  breadcrumb?: string;
};

function escapeAndHighlight(raw: string, terms: string[]): string {
  const s = String(raw || "");
  if (!s) return "";
  if (!terms.length) return escapeHtml(s);

  const hay = s.toLowerCase();
  type Range = { start: number; end: number };
  const ranges: Range[] = [];

  for (const t of terms) {
    if (!t) continue;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(t, from);
      if (i < 0) break;
      ranges.push({ start: i, end: i + t.length });
      from = i + Math.max(1, t.length);
      if (ranges.length > 60) break;
    }
    if (ranges.length > 60) break;
  }

  if (!ranges.length) return escapeHtml(s);

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end) {
      merged.push({ start: r.start, end: r.end });
      continue;
    }
    last.end = Math.max(last.end, r.end);
  }

  let out = "";
  let cur = 0;
  for (const r of merged) {
    if (r.start > cur) out += escapeHtml(s.slice(cur, r.start));
    out += `<span class="notion-search__hl">${escapeHtml(s.slice(r.start, r.end))}</span>`;
    cur = r.end;
  }
  if (cur < s.length) out += escapeHtml(s.slice(cur));
  return out;
}

function ensureSearch(): {
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
          <input id="notion-search-input" type="search" placeholder="Search..." autocomplete="off" spellcheck="false" />
          <button id="notion-search-clear" class="notion-search__clear" type="button" aria-label="Clear query" title="Clear">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M20 6H9l-5 6 5 6h11V6z"></path>
              <path d="m12 10 4 4"></path>
              <path d="m16 10-4 4"></path>
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
            <button id="notion-search-filter-all" class="notion-search__pill is-active" type="button" role="tab" aria-selected="true" data-type="all">All</button>
            <button id="notion-search-filter-pages" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="pages">Pages</button>
            <button id="notion-search-filter-blog" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="blog">Blog</button>
            <button id="notion-search-filter-databases" class="notion-search__pill" type="button" role="tab" aria-selected="false" data-type="databases">Databases</button>
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

function renderEmpty(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__empty-state">No results</div>`;
}

function renderLoader(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__result-loader">Searching...</div>`;
}

function renderResults(list: HTMLElement, items: SearchItem[], query: string) {
  if (!items.length) return renderEmpty(list);
  const terms = tokenizeQuery(query);

  const groupLabelFor = (it: SearchItem): string => {
    const crumb = String(it.breadcrumb || "").trim();
    if (crumb) {
      const parts = crumb.split(" / ").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[1]!;
      if (parts.length === 1) return parts[0]!;
    }
    const rp = String(it.routePath || "/");
    if (rp === "/") return "Home";
    const seg = rp.split("/").filter(Boolean)[0] || "";
    if (!seg) return "Home";
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  };

  const groups = new Map<string, SearchItem[]>();
  for (const it of items) {
    const g = groupLabelFor(it);
    const arr = groups.get(g) || [];
    arr.push(it);
    groups.set(g, arr);
  }

  const groupOrder: string[] = [];
  for (const it of items) {
    const g = groupLabelFor(it);
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  const renderItem = (it: SearchItem, { last }: { last: boolean }) => {
    const titleHtml = escapeAndHighlight(it.title || "Untitled", terms);
    const route = escapeHtml(it.routePath || "/");
    const kind = escapeHtml(it.kind || "page");
    const snippetHtml = escapeAndHighlight(it.snippet || "", terms);
    const crumbRaw = String(it.breadcrumb || "").trim();
    const crumbHtml = crumbRaw ? escapeHtml(crumbRaw) : "";

    return `
      <div class="notion-search__result-item-wrapper${last ? " last" : ""}">
        <a class="notion-search__result-item ${kind}" href="${route}" role="option" aria-selected="false">
          <div class="notion-search__result-item-content">
            <div class="notion-search__result-item-title">
              <span class="notion-semantic-string">${titleHtml}</span>
            </div>
            ${
              snippetHtml
                ? `<div class="notion-search__result-item-text">${snippetHtml}</div><div class="notion-search__result-item-meta">${crumbHtml || route}</div>`
                : `<div class="notion-search__result-item-text">${crumbHtml || route}</div>`
            }
          </div>
          <div class="notion-search__result-item-enter-icon" aria-hidden="true">↵</div>
        </a>
      </div>
    `.trim();
  };

  const total = items.length;
  const out: string[] = [];
  let i = 0;
  for (const g of groupOrder) {
    const arr = groups.get(g) || [];
    if (!arr.length) continue;
    out.push(
      `<div class="notion-search__group"><div class="notion-search__group-title">${escapeHtml(
        g,
      )}</div><div class="notion-search__group-count">${arr.length}</div></div>`,
    );
    for (const it of arr) {
      i += 1;
      out.push(renderItem(it, { last: i === total }));
    }
  }

  list.innerHTML = out.join("");
}

async function fetchResults(
  q: string,
  opts: { type: string; scope: string },
  signal: AbortSignal,
): Promise<SearchItem[]> {
  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", q);
  if (opts.type && opts.type !== "all") url.searchParams.set("type", opts.type);
  if (opts.scope) url.searchParams.set("scope", opts.scope);
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
        breadcrumb: String(o.breadcrumb || ""),
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

    const {
      root,
      wrapper,
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
    } = ensureSearch();

    let open = false;
    let lastFocus: HTMLElement | null = null;
    let aborter: AbortController | null = null;
    let debounceTimer: number | null = null;
    let activeIndex = -1;
    let filterType: "all" | "pages" | "blog" | "databases" = "all";
    let scopeEnabled = false;
    let scopePrefix = "";
    let scopeLabel = "";

    const computeScope = (): { prefix: string; label: string } => {
      const p = String(window.location.pathname || "/");
      if (!p || p === "/" || p.startsWith("/site-admin")) return { prefix: "", label: "" };
      // Blog: keep it tight.
      if (p === "/blog" || p.startsWith("/blog/")) return { prefix: "/blog", label: "Blog" };
      const seg = p.split("/").filter(Boolean)[0] || "";
      if (!seg) return { prefix: "", label: "" };
      const prefix = `/${seg}`;
      const label = seg.charAt(0).toUpperCase() + seg.slice(1);
      return { prefix, label };
    };

    const setFilterPillState = () => {
      const set = (btn: HTMLButtonElement, on: boolean) => {
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      };
      set(filterAll, filterType === "all");
      set(filterPages, filterType === "pages");
      set(filterBlog, filterType === "blog");
      set(filterDatabases, filterType === "databases");

      if (scopePrefix && scopeLabel) {
        scopeBtn.classList.remove("is-hidden");
        scopeBtn.textContent = scopeEnabled ? `In ${scopeLabel}` : `This section: ${scopeLabel}`;
        scopeBtn.setAttribute("aria-pressed", scopeEnabled ? "true" : "false");
        scopeBtn.classList.toggle("is-active", scopeEnabled);
      } else {
        scopeBtn.classList.add("is-hidden");
        scopeBtn.setAttribute("aria-pressed", "false");
        scopeBtn.classList.remove("is-active");
      }
    };

    const setClearState = () => {
      const has = Boolean(input.value.trim());
      clearBtn.classList.toggle("is-hidden", !has);
      clearBtn.setAttribute("aria-hidden", has ? "false" : "true");
      clearBtn.tabIndex = has ? 0 : -1;
    };

    const getResultItems = (): HTMLAnchorElement[] =>
      Array.from(list.querySelectorAll<HTMLAnchorElement>(".notion-search__result-item"));

    const setActive = (idx: number) => {
      const items = getResultItems();
      if (!items.length) {
        activeIndex = -1;
        return;
      }
      const next = Math.max(0, Math.min(idx, items.length - 1));
      activeIndex = next;
      for (let i = 0; i < items.length; i += 1) {
        const el = items[i]!;
        const on = i === activeIndex;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      }
      items[activeIndex]!.scrollIntoView({ block: "nearest" });
    };

    const renderFooterHint = (mode: "idle" | "results") => {
      if (mode === "idle") {
        footer.innerHTML = `<div class="notion-search__result-footer-shortcut">Esc</div> to close`;
        return;
      }
      footer.innerHTML =
        `<div class="notion-search__result-footer-shortcut">Esc</div> close` +
        `<span class="notion-search__result-footer-dot">·</span>` +
        `<div class="notion-search__result-footer-shortcut">↑</div>` +
        `<div class="notion-search__result-footer-shortcut">↓</div> navigate` +
        `<span class="notion-search__result-footer-dot">·</span>` +
        `<div class="notion-search__result-footer-shortcut">↵</div> open`;
    };

    const setOpen = (next: boolean) => {
      open = next;
      root.classList.toggle("open", open);
      root.classList.toggle("close", !open);
      root.setAttribute("data-open", open ? "true" : "false");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        lastFocus = document.activeElement as HTMLElement | null;
        input.value = "";
        filterType = "all";
        scopeEnabled = false;
        const s = computeScope();
        scopePrefix = s.prefix;
        scopeLabel = s.label;
        setFilterPillState();
        setClearState();
        renderEmpty(list);
        activeIndex = -1;
        renderFooterHint("idle");
        window.setTimeout(() => input.focus(), 0);
      } else {
        aborter?.abort();
        aborter = null;
        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = null;
        activeIndex = -1;
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        lastFocus = null;
      }
    };

    const close = () => setOpen(false);
    const openSearch = () => setOpen(true);

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

    const isTypingContext = (t: EventTarget | null) => {
      const el = t instanceof Element ? t : null;
      if (!el) return false;
      if (el.closest("[contenteditable='true']")) return true;
      const tag = el.tagName?.toLowerCase?.() || "";
      return tag === "input" || tag === "textarea" || tag === "select";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Global open shortcuts (Super-like).
      if (!open) {
        if (isTypingContext(e.target)) return;
        const k = e.key.toLowerCase();
        if ((k === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
          e.preventDefault();
          openSearch();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(activeIndex + 1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(activeIndex - 1);
        return;
      }

      if (e.key === "Enter") {
        const items = getResultItems();
        const el = items[activeIndex] || items[0];
        if (!el) return;
        e.preventDefault();
        el.click();
      }
    };

    const runSearch = (q: string) => {
      const query = q.trim();
      if (!query) {
        aborter?.abort();
        aborter = null;
        renderEmpty(list);
        activeIndex = -1;
        renderFooterHint("idle");
        return;
      }

      aborter?.abort();
      aborter = new AbortController();
      renderLoader(list);
      activeIndex = -1;

      void (async () => {
        const items = await fetchResults(
          query,
          { type: filterType, scope: scopeEnabled ? scopePrefix : "" },
          aborter!.signal,
        ).catch(() => []);
        if (aborter?.signal.aborted) return;
        renderResults(list, items, query);
        if (items.length) setActive(0);
        renderFooterHint("results");
      })();
    };

    const onInput = () => {
      if (!open) return;
      setClearState();
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => runSearch(input.value), 140);
    };

    const onClear = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!open) return;
      if (!input.value.trim()) return;
      input.value = "";
      input.focus();
      setClearState();
      renderEmpty(list);
      activeIndex = -1;
      renderFooterHint("idle");
    };

    const onClose = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!open) return;
      close();
    };

    trigger.addEventListener("click", onTriggerClick);
    wrapper.addEventListener("click", onWrapperClick);
    document.addEventListener("keydown", onKeyDown, true);
    input.addEventListener("input", onInput);
    clearBtn.addEventListener("click", onClear);
    closeBtn.addEventListener("click", onClose);

    const onFilterClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const btn = t.closest("button[data-type]") as HTMLButtonElement | null;
      if (!btn) return;
      const next = String(btn.getAttribute("data-type") || "all") as typeof filterType;
      if (!open) return;
      filterType = (["all", "pages", "blog", "databases"].includes(next) ? next : "all") as typeof filterType;
      setFilterPillState();
      runSearch(input.value);
    };

    const onScopeClick = (e: MouseEvent) => {
      e.preventDefault();
      if (!open) return;
      if (!scopePrefix) return;
      scopeEnabled = !scopeEnabled;
      setFilterPillState();
      runSearch(input.value);
    };

    filterAll.addEventListener("click", onFilterClick);
    filterPages.addEventListener("click", onFilterClick);
    filterBlog.addEventListener("click", onFilterClick);
    filterDatabases.addEventListener("click", onFilterClick);
    scopeBtn.addEventListener("click", onScopeClick);

    // Close on navigation.
    if (open) close();

    return () => {
      trigger.removeEventListener("click", onTriggerClick);
      wrapper.removeEventListener("click", onWrapperClick);
      document.removeEventListener("keydown", onKeyDown, true);
      input.removeEventListener("input", onInput);
      clearBtn.removeEventListener("click", onClear);
      closeBtn.removeEventListener("click", onClose);
      filterAll.removeEventListener("click", onFilterClick);
      filterPages.removeEventListener("click", onFilterClick);
      filterBlog.removeEventListener("click", onFilterClick);
      filterDatabases.removeEventListener("click", onFilterClick);
      scopeBtn.removeEventListener("click", onScopeClick);
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
