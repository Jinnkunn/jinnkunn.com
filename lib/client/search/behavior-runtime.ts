import { createFocusTrap, lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";
import {
  computeScopeFromPathname,
  getVisibleResultItems,
  loadSearchState,
  renderFooterHint,
  saveSearchState,
  setActiveResult,
  setClearButtonState,
  setFilterPillState,
} from "@/lib/client/search/behavior-helpers";
import { ensureSearch, renderEmpty } from "@/lib/client/search/overlay";

import { handleSearchFocusIn, handleSearchKeyDown } from "./behavior-runtime-keyboard";
import { handleSearchResultsClick, runSearchQuery } from "./behavior-runtime-query";
import {
  parseSearchType,
  type SearchRootElement,
  type SearchRuntimeState,
} from "./behavior-runtime-types";

export function setupSearchBehavior(): (() => void) | undefined {
  const trigger = document.getElementById("search-trigger") as HTMLButtonElement | null;
  if (!trigger) return undefined;

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
  const rootEl = root as SearchRootElement;
  const pageLimit = 20;

  const state: SearchRuntimeState = {
    open: false,
    lastFocus: null,
    aborter: null,
    debounceTimer: null,
    activeIndex: -1,
    unlockScroll: null,
    filterType: "all",
    scopeEnabled: false,
    scopePrefix: "",
    scopeLabel: "",
    lastMeta: null,
    currentQuery: "",
    currentItems: [],
    collapsedGroups: new Set<string>(),
  };

  const trap = createFocusTrap(box, { fallback: input });

  const applyMetaCounts = (meta: SearchRuntimeState["lastMeta"]) => {
    state.lastMeta = meta;
    const counts = meta?.counts || null;

    const setCount = (btn: HTMLButtonElement, n: number) => {
      const el = btn.querySelector<HTMLElement>(".notion-search__pill-count");
      if (el) el.textContent = Number.isFinite(n) ? String(n) : "";
      btn.classList.remove("is-disabled");
      btn.disabled = false;
    };

    setCount(filterAll, counts ? counts.all : NaN);
    setCount(filterPages, counts ? counts.pages : NaN);
    setCount(filterBlog, counts ? counts.blog : NaN);
    setCount(filterDatabases, counts ? counts.databases : NaN);
  };

  const persistState = () => {
    saveSearchState(state.filterType, state.scopeEnabled);
  };

  const syncPillState = () => {
    setFilterPillState({
      elements: {
        filterAll,
        filterPages,
        filterBlog,
        filterDatabases,
        scopeBtn,
      },
      filterType: state.filterType,
      scopeEnabled: state.scopeEnabled,
      scopePrefix: state.scopePrefix,
      scopeLabel: state.scopeLabel,
    });
  };

  const syncClearState = () => {
    setClearButtonState(input, clearBtn);
  };

  const setActive = (idx: number) => {
    state.activeIndex = setActiveResult(list, idx);
  };

  const getResultItems = () => getVisibleResultItems(list);

  const setFooterHint = (mode: "idle" | "results") => {
    renderFooterHint(footer, mode);
  };

  const queryDeps = {
    state,
    rootEl,
    list,
    input,
    pageLimit,
    applyMetaCounts,
    setFooterHint,
    setActive,
    syncPillState,
    persistState,
  };

  const runSearch = (q: string) => runSearchQuery(queryDeps, q);

  const setOpen = (next: boolean) => {
    state.open = next;
    root.classList.toggle("open", state.open);
    root.classList.toggle("close", !state.open);
    root.setAttribute("data-open", state.open ? "true" : "false");
    trigger.setAttribute("aria-expanded", state.open ? "true" : "false");

    if (state.open) {
      setClassicInert(true);
      if (!state.unlockScroll) state.unlockScroll = lockBodyScroll();

      state.lastFocus = document.activeElement as HTMLElement | null;
      input.value = "";
      const remembered = loadSearchState();
      state.filterType = remembered.filterType || "all";
      state.scopeEnabled = Boolean(remembered.scopeEnabled);
      const s = computeScopeFromPathname(window.location.pathname);
      state.scopePrefix = s.prefix;
      state.scopeLabel = s.label;
      if (!state.scopePrefix) state.scopeEnabled = false;
      syncPillState();
      applyMetaCounts(null);
      syncClearState();
      renderEmpty(list);
      state.activeIndex = -1;
      setFooterHint("idle");
      window.setTimeout(() => input.focus(), 0);
      return;
    }

    state.aborter?.abort();
    state.aborter = null;
    if (state.debounceTimer) window.clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
    state.activeIndex = -1;
    applyMetaCounts(null);
    setClassicInert(false);
    if (state.unlockScroll) {
      state.unlockScroll();
      state.unlockScroll = null;
    }
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
    state.lastFocus = null;
  };

  const close = () => setOpen(false);
  const openSearch = () => setOpen(true);

  rootEl.__closeSearch = close;
  rootEl.__emptySwitchType = undefined;

  const onTriggerClick = (e: MouseEvent) => {
    e.preventDefault();
    setOpen(!state.open);
  };

  const onWrapperClick = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest(".notion-search__box")) return;
    close();
  };

  const onFocusIn = (e: FocusEvent) => {
    handleSearchFocusIn(
      { state, trap, openSearch, close, setActive, getResultItems },
      e,
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    handleSearchKeyDown(
      { state, trap, openSearch, close, setActive, getResultItems },
      e,
    );
  };

  const onInput = () => {
    if (!state.open) return;
    syncClearState();
    if (state.debounceTimer) window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => runSearch(input.value), 140);
  };

  const onClear = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.open) return;
    if (!input.value.trim()) return;
    input.value = "";
    input.focus();
    syncClearState();
    renderEmpty(list);
    state.activeIndex = -1;
    setFooterHint("idle");
  };

  const onClose = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.open) return;
    close();
  };

  const onFilterClick = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const btn = t.closest("button[data-type]") as HTMLButtonElement | null;
    if (!btn) return;
    if (!state.open) return;
    state.filterType = parseSearchType(btn.getAttribute("data-type"));
    persistState();
    syncPillState();
    runSearch(input.value);
  };

  const onScopeClick = (e: MouseEvent) => {
    e.preventDefault();
    if (!state.open) return;
    if (!state.scopePrefix) return;
    state.scopeEnabled = !state.scopeEnabled;
    persistState();
    syncPillState();
    runSearch(input.value);
  };

  const onResultsClick = (e: MouseEvent) => {
    handleSearchResultsClick(queryDeps, e);
  };

  trigger.addEventListener("click", onTriggerClick);
  wrapper.addEventListener("click", onWrapperClick);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  input.addEventListener("input", onInput);
  clearBtn.addEventListener("click", onClear);
  closeBtn.addEventListener("click", onClose);
  filterAll.addEventListener("click", onFilterClick);
  filterPages.addEventListener("click", onFilterClick);
  filterBlog.addEventListener("click", onFilterClick);
  filterDatabases.addEventListener("click", onFilterClick);
  scopeBtn.addEventListener("click", onScopeClick);
  list.addEventListener("click", onResultsClick);

  return () => {
    close();
    rootEl.__closeSearch = undefined;
    rootEl.__emptySwitchType = undefined;
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
    state.aborter?.abort();
    state.aborter = null;
    setClassicInert(false);
    if (state.unlockScroll) state.unlockScroll();
  };
}

export function closeOpenSearchOverlay(): void {
  const root = document.getElementById("notion-search") as SearchRootElement | null;
  if (!root) return;
  if (!root.classList.contains("open")) return;
  if (typeof root.__closeSearch === "function") root.__closeSearch();
}
