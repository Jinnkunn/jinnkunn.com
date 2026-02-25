import { createFocusTrap, lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";

import type { SiteNavElements } from "./elements";
import { setActiveLinks } from "./active-links";
import {
  applyMobileMenuOpenLayout,
  attachMoreMenuHeightObserver,
  hideMobileMenuImmediately,
  playMobileMenuEnter,
  playMobileMenuExit,
  setMobilePageState,
} from "./menu-animation";
import { createMenuEventHandlers } from "./menu-events";
import { focusMoreMenuItem, getMoreMenuItems } from "./menu-focus";
import { clearCloseTimers, createNavMenuState } from "./menu-state";

export function setupSiteNavMenuBehavior({
  nav,
  moreBtn,
  moreMenu,
  mobileBtn,
  mobileMenu,
  mobileBackdrop,
  mobileClose,
  mobileDialog,
}: SiteNavElements): () => void {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const mobileTrap = createFocusTrap(mobileDialog, {
    exclude: (el) => el.id === "mobile-backdrop",
    fallback: mobileClose ?? mobileBtn,
  });
  const state = createNavMenuState();

  const getMoreItems = () => getMoreMenuItems(moreMenu);
  const focusMoreItem = (which: "first" | "last" | number) => {
    focusMoreMenuItem(moreMenu, which);
  };

  const setMobileOpen = (open: boolean, opts: { restoreFocus?: boolean } = {}) => {
    if (state.mobileOpen === open) return;
    state.mobileOpen = open;
    mobileBtn.setAttribute("aria-expanded", open ? "true" : "false");
    clearCloseTimers(state);

    if (open) {
      setMoreOpen(false);

      state.mobilePrevFocus = document.activeElement as HTMLElement | null;
      mobileMenu.hidden = false;
      mobileMenu.removeAttribute("inert");
      mobileMenu.setAttribute("data-state", "open");
      applyMobileMenuOpenLayout(mobileMenu);
      setClassicInert(true);
      setMobilePageState(true);
      playMobileMenuEnter(mobileMenu);

      if (!state.unlockScroll) state.unlockScroll = lockBodyScroll();
      requestAnimationFrame(() => {
        mobileTrap.focusFirst();
      });
      return;
    }

    mobileMenu.setAttribute("inert", "");
    mobileMenu.setAttribute("data-state", "closed");
    setClassicInert(false);
    setMobilePageState(false);

    if (prefersReducedMotion) {
      hideMobileMenuImmediately(mobileMenu);
    } else {
      state.mobileCloseTimer = playMobileMenuExit(mobileMenu, () => {
        mobileMenu.hidden = true;
        mobileMenu.style.display = "none";
      });
    }

    if (state.unlockScroll) {
      state.unlockScroll();
      state.unlockScroll = null;
    }

    if (opts.restoreFocus) {
      const toFocus =
        (state.mobilePrevFocus && document.contains(state.mobilePrevFocus)
          ? state.mobilePrevFocus
          : mobileBtn) ?? mobileBtn;
      requestAnimationFrame(() => toFocus?.focus?.());
    }
    state.mobilePrevFocus = null;
  };

  const setMoreOpen = (open: boolean, opts: { focus?: "first" | "last" } = {}) => {
    if (state.moreOpen === open) return;
    state.moreOpen = open;
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    clearCloseTimers(state);

    if (open) {
      setMobileOpen(false);

      moreMenu.style.display = "";
      moreMenu.setAttribute("data-state", "open");
      moreMenu.removeAttribute("inert");
      requestAnimationFrame(() => {
        state.moreResizeObserver = attachMoreMenuHeightObserver(moreMenu, state.moreResizeObserver);
      });

      const targetFocus = opts.focus;
      if (targetFocus) requestAnimationFrame(() => focusMoreItem(targetFocus));
      return;
    }

    state.moreResizeObserver?.disconnect();
    moreMenu.setAttribute("data-state", "closed");
    moreMenu.setAttribute("inert", "");
    if (prefersReducedMotion) {
      moreMenu.style.display = "none";
    } else {
      state.moreCloseTimer = window.setTimeout(() => {
        moreMenu.style.display = "none";
      }, 220);
    }
  };

  const closeAll = () => {
    setMoreOpen(false);
    setMobileOpen(false);
  };

  const handlers = createMenuEventHandlers({
    nav,
    moreBtn,
    moreMenu,
    mobileBtn,
    mobileDialog,
    mobileTrap,
    getMoreOpen: () => state.moreOpen,
    getMobileOpen: () => state.mobileOpen,
    getMobilePrevFocus: () => state.mobilePrevFocus,
    getMoreItems,
    focusMoreItem,
    setMoreOpen,
    setMobileOpen,
    closeAll,
  });

  moreMenu.style.display = "none";
  moreMenu.setAttribute("data-state", "closed");
  moreMenu.setAttribute("inert", "");
  moreBtn.setAttribute("aria-expanded", "false");
  mobileBtn.setAttribute("aria-expanded", "false");
  mobileMenu.hidden = true;
  mobileMenu.setAttribute("inert", "");
  mobileMenu.setAttribute("data-state", "closed");
  setActiveLinks(nav);

  window.addEventListener("pointerdown", handlers.onPointerDown, { passive: true });
  window.addEventListener("keydown", handlers.onKeyDown);
  window.addEventListener("focusin", handlers.onFocusIn);
  nav.addEventListener("click", handlers.onNavClickCapture, true);
  moreBtn.addEventListener("click", handlers.onMoreClick);
  moreBtn.addEventListener("keydown", handlers.onMoreTriggerKeyDown);
  moreMenu.addEventListener("keydown", handlers.onMoreMenuKeyDown, true);
  moreBtn.addEventListener("pointerenter", handlers.onMorePointerEnter);
  moreBtn.addEventListener("pointerleave", handlers.onMorePointerLeave);
  moreMenu.addEventListener("pointerenter", handlers.onMorePointerEnter);
  moreMenu.addEventListener("pointerleave", handlers.onMorePointerLeave);
  mobileBtn.addEventListener("click", handlers.onMobileClick);
  mobileBackdrop.addEventListener("click", handlers.onBackdropClick);
  mobileClose.addEventListener("click", handlers.onCloseBtnClick);

  const onPopState = () => {
    closeAll();
    setActiveLinks(nav);
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    clearCloseTimers(state);
    state.moreResizeObserver?.disconnect();
    window.removeEventListener("pointerdown", handlers.onPointerDown);
    window.removeEventListener("keydown", handlers.onKeyDown);
    window.removeEventListener("focusin", handlers.onFocusIn);
    nav.removeEventListener("click", handlers.onNavClickCapture, true);
    moreBtn.removeEventListener("click", handlers.onMoreClick);
    moreBtn.removeEventListener("keydown", handlers.onMoreTriggerKeyDown);
    moreMenu.removeEventListener("keydown", handlers.onMoreMenuKeyDown, true);
    moreBtn.removeEventListener("pointerenter", handlers.onMorePointerEnter);
    moreBtn.removeEventListener("pointerleave", handlers.onMorePointerLeave);
    moreMenu.removeEventListener("pointerenter", handlers.onMorePointerEnter);
    moreMenu.removeEventListener("pointerleave", handlers.onMorePointerLeave);
    handlers.clearMoreHoverClose();
    mobileBtn.removeEventListener("click", handlers.onMobileClick);
    mobileBackdrop.removeEventListener("click", handlers.onBackdropClick);
    mobileClose.removeEventListener("click", handlers.onCloseBtnClick);
    window.removeEventListener("popstate", onPopState);
    if (state.unlockScroll) state.unlockScroll();
    setMobilePageState(false);
    setClassicInert(false);
  };
}
