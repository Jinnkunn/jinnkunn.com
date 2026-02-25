export type NavMenuState = {
  moreOpen: boolean;
  mobileOpen: boolean;
  unlockScroll: null | (() => void);
  moreCloseTimer: number | null;
  mobileCloseTimer: number | null;
  mobilePrevFocus: HTMLElement | null;
  moreResizeObserver: ResizeObserver | null;
  moreHoverCloseTimer: number | null;
};

export function createNavMenuState(): NavMenuState {
  return {
    moreOpen: false,
    mobileOpen: false,
    unlockScroll: null,
    moreCloseTimer: null,
    mobileCloseTimer: null,
    mobilePrevFocus: null,
    moreResizeObserver: null,
    moreHoverCloseTimer: null,
  };
}

export function clearCloseTimers(state: NavMenuState): void {
  if (state.moreCloseTimer) window.clearTimeout(state.moreCloseTimer);
  if (state.mobileCloseTimer) window.clearTimeout(state.mobileCloseTimer);
  state.moreCloseTimer = null;
  state.mobileCloseTimer = null;
}

export function clearMoreHoverCloseTimer(state: NavMenuState): void {
  if (state.moreHoverCloseTimer) window.clearTimeout(state.moreHoverCloseTimer);
  state.moreHoverCloseTimer = null;
}
