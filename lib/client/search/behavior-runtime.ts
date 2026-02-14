import { createFocusTrap, setClassicInert } from "@/lib/client/dom-utils";
import {
  getVisibleResultItems,
  renderFooterHint,
  saveSearchState,
  setActiveResult,
  setClearButtonState,
  setFilterPillState,
} from "@/lib/client/search/behavior-helpers";
import { ensureSearch } from "@/lib/client/search/overlay";

import { createSearchActionHandlers } from "./behavior-runtime-actions";
import { handleSearchFocusIn, handleSearchKeyDown } from "./behavior-runtime-keyboard";
import { createSearchOpenStateController } from "./behavior-runtime-open-state";
import { runSearchQuery } from "./behavior-runtime-query";
import {
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

  const { setOpen, close, openSearch } = createSearchOpenStateController({
    state,
    root,
    trigger,
    input,
    list,
    applyMetaCounts,
    syncPillState,
    syncClearState,
    setFooterHint,
  });

  rootEl.__closeSearch = close;
  rootEl.__emptySwitchType = undefined;

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

  const {
    onTriggerClick,
    onWrapperClick,
    onInput,
    onClear,
    onClose,
    onFilterClick,
    onScopeClick,
    onResultsClick,
  } = createSearchActionHandlers({
    state,
    input,
    list,
    setOpen,
    close,
    syncClearState,
    setFooterHint,
    persistState,
    syncPillState,
    runSearch,
    queryDeps,
  });

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
