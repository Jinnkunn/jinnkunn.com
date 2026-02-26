export type NavMenuState = {
  moreOpen: boolean;
  mobileOpen: boolean;
  unlockScroll: null | (() => void);
  moreCloseTimer: number | null;
  mobileCloseTimer: number | null;
  mobilePrevFocus: HTMLElement | null;
  moreResizeObserver: ResizeObserver | null;
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
  };
}

export function clearCloseTimers(state: NavMenuState): void {
  if (state.moreCloseTimer) window.clearTimeout(state.moreCloseTimer);
  if (state.mobileCloseTimer) window.clearTimeout(state.mobileCloseTimer);
  state.moreCloseTimer = null;
  state.mobileCloseTimer = null;
}
