"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { createFocusTrap, isTypingContext, lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";
import { fetchSearchResults } from "@/lib/client/search/api";
import { ensureSearch, renderEmpty, renderLoader, renderResults } from "@/lib/client/search/overlay";
import type { SearchMeta, SearchType } from "@/lib/client/search/types";
import type { SearchItem } from "@/lib/client/site-search-render";

export default function SiteSearchBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const trigger = document.getElementById("search-trigger") as HTMLButtonElement | null;
    if (!trigger) return;

    const {
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
    } = ensureSearch();

    let open = false;
    let lastFocus: HTMLElement | null = null;
    let aborter: AbortController | null = null;
    let debounceTimer: number | null = null;
    let activeIndex = -1;
    let unlockScroll: null | (() => void) = null;
    let filterType: SearchType = "all";
    let scopeEnabled = false;
    let scopePrefix = "";
    let scopeLabel = "";
    let lastMeta: SearchMeta | null = null;
    let currentQuery = "";
    let currentItems: SearchItem[] = [];
    const collapsedGroups = new Set<string>();
    const pageLimit = 20;
    const trap = createFocusTrap(box, { fallback: input });

    const STORAGE_KEY = "notion-search-state:v1";
    const loadState = (): { filterType: SearchType; scopeEnabled: boolean } => {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY) || "";
        if (!raw) return { filterType: "all", scopeEnabled: false };
        const j = JSON.parse(raw) as Record<string, unknown>;
        const ft = String(j.filterType || "all") as SearchType;
        const scope = Boolean(j.scopeEnabled);
        const filterType =
          (["all", "pages", "blog", "databases"].includes(ft) ? ft : "all") as SearchType;
        return { filterType, scopeEnabled: scope };
      } catch {
        return { filterType: "all", scopeEnabled: false };
      }
    };

    const saveState = () => {
      try {
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ filterType, scopeEnabled }),
        );
      } catch {
        // ignore
      }
    };

    const groupCountsFromMeta = (meta: SearchMeta | null): Record<string, number> | undefined => {
      const arr = meta?.groups;
      if (!arr || !Array.isArray(arr) || !arr.length) return undefined;
      const out: Record<string, number> = {};
      for (const g of arr) {
        if (!g?.label) continue;
        const n = Number(g.count);
        if (!Number.isFinite(n)) continue;
        out[g.label] = n;
      }
      return out;
    };

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
        // Keep tabs always clickable (even if count=0) so users can verify "no results".
        // This also avoids UI getting stuck when counts are briefly unknown.
        btn.classList.remove("is-disabled");
        btn.disabled = false;
        return neverDisable ? undefined : undefined;
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
        setClassicInert(true);
        if (!unlockScroll) unlockScroll = lockBodyScroll();

        lastFocus = document.activeElement as HTMLElement | null;
        input.value = "";
        const remembered = loadState();
        filterType = remembered.filterType || "all";
        scopeEnabled = Boolean(remembered.scopeEnabled);
        const s = computeScope();
        scopePrefix = s.prefix;
        scopeLabel = s.label;
        // If there's no usable scope in this section, disable remembered scope.
        if (!scopePrefix) scopeEnabled = false;
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
        setClassicInert(false);
        if (unlockScroll) {
          unlockScroll();
          unlockScroll = null;
        }
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        lastFocus = null;
      }
    };

    const close = () => setOpen(false);
    const openSearch = () => setOpen(true);

    // Expose an imperative close hook so other effects (e.g., route change)
    // can close the modal while properly releasing scroll/inert state.
    (root as unknown as { __closeSearch?: () => void }).__closeSearch = close;
    (root as unknown as { __emptySwitchType?: SearchType }).__emptySwitchType = undefined;

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

    const onFocusIn = (e: FocusEvent) => {
      if (!open) return;
      trap.onFocusIn(e);
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

      if (e.key === "Tab") {
        trap.onKeyDown(e);
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
        const { items, meta } = await fetchSearchResults(
          query,
          { type: filterType, scope: scopeEnabled ? scopePrefix : "", offset: 0, limit: pageLimit },
          aborter!.signal,
        ).catch(() => ({ items: [], meta: null }));
        if (aborter?.signal.aborted) return;
        applyMetaCounts(meta);
        currentItems = items;
        if (!currentItems.length) {
          const actions: Array<{ id: string; label: string; hint?: string }> = [];
          const counts = meta?.counts || null;

          if (filterType !== "all" && counts && Number(counts.all) > 0) {
            // Suggest the best matching type tab.
            const candidates: Array<[SearchType, number]> = [
              ["pages", Number(counts.pages) || 0],
              ["blog", Number(counts.blog) || 0],
              ["databases", Number(counts.databases) || 0],
            ];
            candidates.sort((a, b) => b[1] - a[1]);
            const best = candidates.find(([, n]) => n > 0) || null;
            if (best) {
              const [t, n] = best;
              const label =
                t === "pages" ? "Show Pages" : t === "blog" ? "Show Blog" : "Show Databases";
              actions.push({
                id: "notion-search-empty-switch-type",
                label,
                hint: `(${n})`,
              });
              (root as unknown as { __emptySwitchType?: SearchType }).__emptySwitchType = t;
            } else {
              actions.push({
                id: "notion-search-empty-switch-all",
                label: "Show all types",
              });
            }
          }

          if (scopeEnabled && scopePrefix) {
            // Diagnose: if there are results outside the scope, offer a one-click expand.
            const outOfScope = await fetchSearchResults(
              query,
              { type: filterType, scope: "", offset: 0, limit: 1 },
              aborter!.signal,
            ).catch(() => ({ items: [], meta: null }));
            if (!aborter?.signal.aborted && Number(outOfScope.meta?.total || 0) > 0) {
              actions.push({
                id: "notion-search-empty-disable-scope",
                label: "Search all sections",
              });
            }
          }

          renderEmpty(list, { actions });
          renderFooterHint("results");
          activeIndex = -1;
          return;
        }

        const showMore = Boolean(meta?.hasMore);
        const remaining = meta ? Math.max(0, meta.filteredTotal - currentItems.length) : 0;
        renderResults(list, currentItems, query, {
          collapsedGroups,
          showMore,
          remaining,
          groupCounts: groupCountsFromMeta(meta),
        });
        setActive(0);
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
    document.addEventListener("focusin", onFocusIn, true);
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
      saveState();
      setFilterPillState();
      runSearch(input.value);
    };

    const onScopeClick = (e: MouseEvent) => {
      e.preventDefault();
      if (!open) return;
      if (!scopePrefix) return;
      scopeEnabled = !scopeEnabled;
      saveState();
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

      const emptyAction = t.closest<HTMLButtonElement>("button.notion-search__empty-action");
      if (emptyAction) {
        e.preventDefault();
        const id = emptyAction.id;
        if (id === "notion-search-empty-disable-scope") {
          scopeEnabled = false;
          saveState();
          setFilterPillState();
          runSearch(input.value);
          return;
        }
        if (id === "notion-search-empty-switch-all") {
          filterType = "all";
          saveState();
          setFilterPillState();
          runSearch(input.value);
          return;
        }
        if (id === "notion-search-empty-switch-type") {
          const targetType = (root as unknown as { __emptySwitchType?: SearchType }).__emptySwitchType;
          if (targetType && ["pages", "blog", "databases"].includes(targetType)) {
            filterType = targetType;
            saveState();
            setFilterPillState();
            runSearch(input.value);
            return;
          }
        }
      }

      const groupBtn = t.closest<HTMLButtonElement>("button.notion-search__group");
      if (groupBtn) {
        e.preventDefault();
        const g = String(groupBtn.getAttribute("data-group") || "").trim();
        if (!g) return;
        if (collapsedGroups.has(g)) collapsedGroups.delete(g);
        else collapsedGroups.add(g);

        const showMore = Boolean(lastMeta?.hasMore);
        const remaining = lastMeta ? Math.max(0, lastMeta.filteredTotal - currentItems.length) : 0;
        renderResults(list, currentItems, currentQuery, {
          collapsedGroups,
          showMore,
          remaining,
          groupCounts: groupCountsFromMeta(lastMeta),
        });
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
          const { items: nextItems, meta } = await fetchSearchResults(
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
          renderResults(list, currentItems, currentQuery, {
            collapsedGroups,
            showMore: showMore2,
            remaining: remaining2,
            groupCounts: groupCountsFromMeta(meta),
          });
        })();

        return;
      }
    };

    list.addEventListener("click", onResultsClick);

    // Close on navigation.
    if (open) close();

    return () => {
      close();
      (root as unknown as { __closeSearch?: () => void }).__closeSearch = undefined;
      (root as unknown as { __emptySwitchType?: SearchType }).__emptySwitchType = undefined;
      trigger.removeEventListener("click", onTriggerClick);
      wrapper.removeEventListener("click", onWrapperClick);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
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
      setClassicInert(false);
      if (unlockScroll) unlockScroll();
    };
  }, []);

  useEffect(() => {
    // On route change, close the search if it's open (best-effort).
    const root = document.getElementById("notion-search");
    if (!root) return;
    if (!root.classList.contains("open")) return;
    const fn = (root as unknown as { __closeSearch?: () => void }).__closeSearch;
    if (typeof fn === "function") fn();
  }, [pathname]);

  return null;
}
