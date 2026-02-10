"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { renderSearchResultsHtml, type SearchItem } from "@/lib/client/site-search-render";

type SearchMeta = {
  total: number;
  filteredTotal: number;
  counts: { all: number; pages: number; blog: number; databases: number };
  offset: number;
  limit: number;
  hasMore: boolean;
};

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

function renderEmpty(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__empty-state">No results</div>`;
}

function renderLoader(list: HTMLElement) {
  list.innerHTML = `<div class="notion-search__result-loader">Searching...</div>`;
}

function renderResults(
  list: HTMLElement,
  items: SearchItem[],
  query: string,
  opts?: { collapsedGroups?: Set<string>; showMore?: boolean; remaining?: number },
) {
  if (!items.length) return renderEmpty(list);
  list.innerHTML = renderSearchResultsHtml(items, query, opts);
}

async function fetchResults(
  q: string,
  opts: { type: string; scope: string; offset: number; limit: number },
  signal: AbortSignal,
): Promise<{ items: SearchItem[]; meta: SearchMeta | null }> {
  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", q);
  if (opts.type && opts.type !== "all") url.searchParams.set("type", opts.type);
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.offset > 0) url.searchParams.set("offset", String(opts.offset));
  if (opts.limit && opts.limit !== 20) url.searchParams.set("limit", String(opts.limit));
  const res = await fetch(url, { signal, headers: { "cache-control": "no-store" } });
  if (!res.ok) return { items: [], meta: null };
  const data = (await res.json().catch(() => null)) as unknown;
  if (!data || typeof data !== "object") return { items: [], meta: null };
  const items0 = (data as { items?: unknown }).items;
  const meta0 = (data as { meta?: unknown }).meta;

  const meta: SearchMeta | null = (() => {
    if (!meta0 || typeof meta0 !== "object") return null;
    const m = meta0 as Record<string, unknown>;
    const counts0 = m.counts;
    const counts =
      counts0 && typeof counts0 === "object"
        ? (counts0 as Record<string, unknown>)
        : null;
    const all = Number(counts?.all ?? NaN);
    const pages = Number(counts?.pages ?? NaN);
    const blog = Number(counts?.blog ?? NaN);
    const databases = Number(counts?.databases ?? NaN);
    const total = Number(m.total ?? NaN);
    const filteredTotal = Number(m.filteredTotal ?? NaN);
    const offset = Number(m.offset ?? NaN);
    const limit = Number(m.limit ?? NaN);
    const hasMore = Boolean(m.hasMore);
    if (![all, pages, blog, databases, total, filteredTotal, offset, limit].every((n) => Number.isFinite(n)))
      return null;
    return { total, filteredTotal, counts: { all, pages, blog, databases }, offset, limit, hasMore };
  })();

  const items = Array.isArray(items0) ? items0 : [];
  const out = items
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
  return { items: out, meta };
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
    let lastMeta: SearchMeta | null = null;
    let currentQuery = "";
    let currentItems: SearchItem[] = [];
    const collapsedGroups = new Set<string>();
    const pageLimit = 20;

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

    const applyMetaCounts = (meta: SearchMeta | null) => {
      lastMeta = meta;
      const counts = meta?.counts || null;

      const setCount = (btn: HTMLButtonElement, n: number, { neverDisable }: { neverDisable?: boolean } = {}) => {
        const el = btn.querySelector<HTMLElement>(".notion-search__pill-count");
        if (el) el.textContent = Number.isFinite(n) ? String(n) : "";
        if (neverDisable) {
          btn.classList.remove("is-disabled");
          btn.disabled = false;
          return;
        }
        const isActive = btn.classList.contains("is-active");
        // If we don't have meta yet, allow switching tabs before the first query.
        const disabled = !counts ? false : (!isActive && (!Number.isFinite(n) || n <= 0));
        btn.classList.toggle("is-disabled", disabled);
        btn.disabled = disabled;
      };

      setCount(filterAll, counts ? counts.all : NaN, { neverDisable: true });
      setCount(filterPages, counts ? counts.pages : NaN);
      setCount(filterBlog, counts ? counts.blog : NaN);
      setCount(filterDatabases, counts ? counts.databases : NaN);
    };

    const setClearState = () => {
      const has = Boolean(input.value.trim());
      clearBtn.classList.toggle("is-hidden", !has);
      clearBtn.setAttribute("aria-hidden", has ? "false" : "true");
      clearBtn.tabIndex = has ? 0 : -1;
    };

    const getResultItems = (): HTMLAnchorElement[] =>
      Array.from(list.querySelectorAll<HTMLAnchorElement>(".notion-search__result-item")).filter((el) => {
        const parent = el.closest<HTMLElement>(".notion-search__group-items");
        if (!parent) return true;
        return !parent.classList.contains("is-collapsed");
      });

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
        applyMetaCounts(null);
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
        applyMetaCounts(null);
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
      currentQuery = query;
      if (!query) {
        aborter?.abort();
        aborter = null;
        applyMetaCounts(null);
        renderEmpty(list);
        currentItems = [];
        collapsedGroups.clear();
        activeIndex = -1;
        renderFooterHint("idle");
        return;
      }

      aborter?.abort();
      aborter = new AbortController();
      currentItems = [];
      collapsedGroups.clear();
      renderLoader(list);
      activeIndex = -1;

      void (async () => {
        const { items, meta } = await fetchResults(
          query,
          { type: filterType, scope: scopeEnabled ? scopePrefix : "", offset: 0, limit: pageLimit },
          aborter!.signal,
        ).catch(() => ({ items: [], meta: null }));
        if (aborter?.signal.aborted) return;
        applyMetaCounts(meta);
        currentItems = items;
        const showMore = Boolean(meta?.hasMore);
        const remaining = meta ? Math.max(0, meta.filteredTotal - currentItems.length) : 0;
        renderResults(list, currentItems, query, { collapsedGroups, showMore, remaining });
        if (currentItems.length) setActive(0);
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

    const onResultsClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;

      const groupBtn = t.closest<HTMLButtonElement>("button.notion-search__group");
      if (groupBtn) {
        e.preventDefault();
        const g = String(groupBtn.getAttribute("data-group") || "").trim();
        if (!g) return;
        if (collapsedGroups.has(g)) collapsedGroups.delete(g);
        else collapsedGroups.add(g);

        const showMore = Boolean(lastMeta?.hasMore);
        const remaining = lastMeta ? Math.max(0, lastMeta.filteredTotal - currentItems.length) : 0;
        renderResults(list, currentItems, currentQuery, { collapsedGroups, showMore, remaining });
        activeIndex = -1;
        return;
      }

      const moreBtn = t.closest<HTMLButtonElement>("#notion-search-more");
      if (moreBtn) {
        e.preventDefault();
        if (!open) return;
        if (!currentQuery.trim()) return;
        if (!lastMeta?.hasMore) return;

        aborter?.abort();
        aborter = new AbortController();
        moreBtn.disabled = true;
        moreBtn.textContent = "Loading...";

        void (async () => {
          const { items: nextItems, meta } = await fetchResults(
            currentQuery,
            { type: filterType, scope: scopeEnabled ? scopePrefix : "", offset: currentItems.length, limit: pageLimit },
            aborter!.signal,
          ).catch(() => ({ items: [], meta: null }));
          if (aborter?.signal.aborted) return;
          applyMetaCounts(meta);
          const seen = new Set(currentItems.map((x) => x.routePath));
          for (const it of nextItems) {
            if (!seen.has(it.routePath)) currentItems.push(it);
          }
          const showMore2 = Boolean(meta?.hasMore);
          const remaining2 = meta ? Math.max(0, meta.filteredTotal - currentItems.length) : 0;
          renderResults(list, currentItems, currentQuery, { collapsedGroups, showMore: showMore2, remaining: remaining2 });
        })();

        return;
      }
    };

    list.addEventListener("click", onResultsClick);

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
      list.removeEventListener("click", onResultsClick);
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
