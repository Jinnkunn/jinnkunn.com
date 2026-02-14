import { renderEmpty } from "@/lib/client/search/overlay";

import { handleSearchResultsClick } from "./behavior-runtime-query";
import { parseSearchType, type SearchRuntimeState } from "./behavior-runtime-types";

type SearchActionHandlerDeps = {
  state: SearchRuntimeState;
  input: HTMLInputElement;
  list: HTMLElement;
  setOpen: (next: boolean) => void;
  close: () => void;
  syncClearState: () => void;
  setFooterHint: (mode: "idle" | "results") => void;
  persistState: () => void;
  syncPillState: () => void;
  runSearch: (query: string) => void;
  queryDeps: Parameters<typeof handleSearchResultsClick>[0];
};

export function createSearchActionHandlers({
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
}: SearchActionHandlerDeps) {
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

  return {
    onTriggerClick,
    onWrapperClick,
    onInput,
    onClear,
    onClose,
    onFilterClick,
    onScopeClick,
    onResultsClick,
  };
}
