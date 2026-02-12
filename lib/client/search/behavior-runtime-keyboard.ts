import { isTypingContext } from "@/lib/client/dom-utils";

import type { SearchRuntimeState } from "./behavior-runtime-types";

type KeyboardDeps = {
  state: SearchRuntimeState;
  trap: {
    onFocusIn: (e: FocusEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  };
  openSearch: () => void;
  close: () => void;
  setActive: (idx: number) => void;
  getResultItems: () => HTMLElement[];
};

export function handleSearchFocusIn(deps: KeyboardDeps, e: FocusEvent): void {
  if (!deps.state.open) return;
  deps.trap.onFocusIn(e);
}

export function handleSearchKeyDown(deps: KeyboardDeps, e: KeyboardEvent): void {
  const { state } = deps;
  if (!state.open) {
    if (isTypingContext(e.target)) return;
    const k = e.key.toLowerCase();
    if ((k === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
      e.preventDefault();
      deps.openSearch();
    }
    return;
  }

  if (e.key === "Tab") {
    deps.trap.onKeyDown(e);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    deps.close();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    deps.setActive(state.activeIndex + 1);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    deps.setActive(state.activeIndex - 1);
    return;
  }

  if (e.key !== "Enter") return;
  const items = deps.getResultItems();
  const el = items[state.activeIndex] || items[0];
  if (!el) return;
  e.preventDefault();
  el.click();
}
