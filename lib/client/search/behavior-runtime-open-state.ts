import { lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";
import { computeScopeFromPathname, loadSearchState } from "@/lib/client/search/behavior-helpers";
import { renderEmpty } from "@/lib/client/search/overlay";

import type { SearchRuntimeState } from "./behavior-runtime-types";

type OpenStateDeps = {
  state: SearchRuntimeState;
  root: HTMLElement;
  trigger: HTMLButtonElement;
  input: HTMLInputElement;
  list: HTMLElement;
  applyMetaCounts: (meta: SearchRuntimeState["lastMeta"]) => void;
  syncPillState: () => void;
  syncClearState: () => void;
  setFooterHint: (mode: "idle" | "results") => void;
};

export function createSearchOpenStateController({
  state,
  root,
  trigger,
  input,
  list,
  applyMetaCounts,
  syncPillState,
  syncClearState,
  setFooterHint,
}: OpenStateDeps) {
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

  return {
    setOpen,
    close: () => setOpen(false),
    openSearch: () => setOpen(true),
  };
}
