import { createFocusTrap, lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";

import type { SiteNavElements } from "./elements";
import { setActiveLinks } from "./active-links";

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

  let moreOpen = false;
  let mobileOpen = false;
  let unlockScroll: null | (() => void) = null;
  let moreCloseTimer: number | null = null;
  let mobileCloseTimer: number | null = null;
  let mobilePrevFocus: HTMLElement | null = null;
  let moreResizeObserver: ResizeObserver | null = null;

  const getMoreItems = () =>
    Array.from(moreMenu.querySelectorAll<HTMLElement>("a.super-navbar__list-item"));

  const focusMoreItem = (which: "first" | "last" | number) => {
    const items = getMoreItems();
    if (items.length === 0) return;
    if (which === "first") return items[0]?.focus();
    if (which === "last") return items[items.length - 1]?.focus();
    const idx = ((which % items.length) + items.length) % items.length;
    return items[idx]?.focus();
  };

  const clearTimers = () => {
    if (moreCloseTimer) window.clearTimeout(moreCloseTimer);
    if (mobileCloseTimer) window.clearTimeout(mobileCloseTimer);
    moreCloseTimer = null;
    mobileCloseTimer = null;
  };

  const setMobileOpen = (open: boolean, opts: { restoreFocus?: boolean } = {}) => {
    if (mobileOpen === open) return;
    mobileOpen = open;
    mobileBtn.setAttribute("aria-expanded", open ? "true" : "false");

    clearTimers();

    if (open) {
      setMoreOpen(false);

      mobilePrevFocus = document.activeElement as HTMLElement | null;
      mobileMenu.hidden = false;
      mobileMenu.removeAttribute("inert");
      mobileMenu.setAttribute("data-state", "open");
      setClassicInert(true);

      mobileMenu.classList.remove("exit", "exit-active");
      mobileMenu.classList.add("enter");
      requestAnimationFrame(() => {
        mobileMenu.classList.remove("enter");
        mobileMenu.classList.add("enter-done");
      });

      if (!unlockScroll) unlockScroll = lockBodyScroll();

      requestAnimationFrame(() => {
        mobileTrap.focusFirst();
      });
    } else {
      mobileMenu.setAttribute("inert", "");
      mobileMenu.setAttribute("data-state", "closed");
      setClassicInert(false);
      if (prefersReducedMotion) {
        mobileMenu.hidden = true;
        mobileMenu.classList.remove("enter", "enter-active", "enter-done");
        mobileMenu.classList.remove("exit", "exit-active");
      } else {
        mobileMenu.classList.remove("enter", "enter-active", "enter-done");
        mobileMenu.classList.add("exit");
        requestAnimationFrame(() => {
          mobileMenu.classList.add("exit-active");
        });
        mobileCloseTimer = window.setTimeout(() => {
          mobileMenu.hidden = true;
          mobileMenu.classList.remove("exit", "exit-active");
        }, 280);
      }

      if (unlockScroll) {
        unlockScroll();
        unlockScroll = null;
      }

      if (opts.restoreFocus) {
        const toFocus =
          (mobilePrevFocus && document.contains(mobilePrevFocus) ? mobilePrevFocus : mobileBtn) ??
          mobileBtn;
        requestAnimationFrame(() => toFocus?.focus?.());
      }
      mobilePrevFocus = null;
    }
  };

  const setMoreOpen = (open: boolean, opts: { focus?: "first" | "last" } = {}) => {
    if (moreOpen === open) return;
    moreOpen = open;
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");

    clearTimers();

    if (open) {
      setMobileOpen(false);

      moreMenu.style.display = "";
      moreMenu.setAttribute("data-state", "open");
      moreMenu.removeAttribute("inert");

      const syncMoreHeight = () => {
        const content = moreMenu.querySelector<HTMLElement>(".super-navbar__list-content");
        if (!content) return;
        const rect = content.getBoundingClientRect();
        const h = Math.max(0, Math.ceil(rect.height));
        moreMenu.style.setProperty("--radix-navigation-menu-viewport-height", `${h}px`);
      };

      requestAnimationFrame(() => {
        syncMoreHeight();
        const content = moreMenu.querySelector<HTMLElement>(".super-navbar__list-content");
        if (content && typeof ResizeObserver !== "undefined") {
          moreResizeObserver?.disconnect();
          moreResizeObserver = new ResizeObserver(() => syncMoreHeight());
          moreResizeObserver.observe(content);
        }
      });
      const targetFocus = opts.focus;
      if (targetFocus) requestAnimationFrame(() => focusMoreItem(targetFocus));
    } else {
      moreResizeObserver?.disconnect();
      moreMenu.setAttribute("data-state", "closed");
      moreMenu.setAttribute("inert", "");
      if (prefersReducedMotion) {
        moreMenu.style.display = "none";
      } else {
        moreCloseTimer = window.setTimeout(() => {
          moreMenu.style.display = "none";
        }, 220);
      }
    }
  };

  const closeAll = () => {
    setMoreOpen(false);
    setMobileOpen(false);
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target instanceof Node ? e.target : null;
    if (!t) return closeAll();

    if (mobileOpen) {
      if (mobileBtn.contains(t) || mobileDialog.contains(t)) return;
      return setMobileOpen(false, { restoreFocus: true });
    }

    if (moreOpen) {
      if (moreBtn.contains(t) || moreMenu.contains(t)) return;
      return setMoreOpen(false);
    }

    if (nav.contains(t)) return;
    closeAll();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab" && mobileOpen) {
      mobileTrap.onKeyDown(e);
      return;
    }

    if (e.key !== "Escape") return;
    e.preventDefault();
    const focusMore = moreOpen;
    const focusMobile = mobileOpen;
    closeAll();
    if (focusMobile) (mobilePrevFocus ?? mobileBtn).focus();
    else if (focusMore) moreBtn.focus();
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!mobileOpen) return;
    mobileTrap.onFocusIn(e);
  };

  const onNavClickCapture = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    const a = t?.closest("a");
    if (!a) return;
    closeAll();
  };

  const onMoreClick = (e: MouseEvent) => {
    e.preventDefault();
    setMoreOpen(!moreOpen);
  };

  const canHover =
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  let moreHoverCloseTimer: number | null = null;
  const clearMoreHoverClose = () => {
    if (moreHoverCloseTimer) window.clearTimeout(moreHoverCloseTimer);
    moreHoverCloseTimer = null;
  };
  const scheduleMoreHoverClose = () => {
    if (!canHover) return;
    clearMoreHoverClose();
    moreHoverCloseTimer = window.setTimeout(() => {
      setMoreOpen(false);
    }, 120);
  };

  const onMorePointerEnter = () => {
    if (!canHover) return;
    clearMoreHoverClose();
    setMoreOpen(true);
  };

  const onMorePointerLeave = () => {
    if (!canHover) return;
    scheduleMoreHoverClose();
  };

  const onMoreTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMoreOpen(true, { focus: "first" });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMoreOpen(true, { focus: "last" });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const next = !moreOpen;
      setMoreOpen(next, next ? { focus: "first" } : {});
      return;
    }
    if (e.key === "Escape" && moreOpen) {
      e.preventDefault();
      setMoreOpen(false);
    }
  };

  const onMoreMenuKeyDown = (e: KeyboardEvent) => {
    if (!moreOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setMoreOpen(false);
      moreBtn.focus();
      return;
    }

    if (e.key === "Tab") {
      setMoreOpen(false);
      return;
    }

    const items = getMoreItems();
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = Math.max(0, items.findIndex((el) => el === active));

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMoreItem(idx + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMoreItem(idx - 1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusMoreItem("first");
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusMoreItem("last");
    }
  };

  const onMobileClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(!mobileOpen);
  };

  const onBackdropClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false, { restoreFocus: true });
  };

  const onCloseBtnClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false, { restoreFocus: true });
  };

  moreMenu.style.display = "none";
  moreMenu.setAttribute("data-state", "closed");
  moreMenu.setAttribute("inert", "");
  moreBtn.setAttribute("aria-expanded", "false");
  mobileBtn.setAttribute("aria-expanded", "false");
  mobileMenu.hidden = true;
  mobileMenu.setAttribute("inert", "");
  mobileMenu.setAttribute("data-state", "closed");
  setActiveLinks(nav);

  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("focusin", onFocusIn);
  nav.addEventListener("click", onNavClickCapture, true);
  moreBtn.addEventListener("click", onMoreClick);
  moreBtn.addEventListener("keydown", onMoreTriggerKeyDown);
  moreMenu.addEventListener("keydown", onMoreMenuKeyDown, true);
  moreBtn.addEventListener("pointerenter", onMorePointerEnter);
  moreBtn.addEventListener("pointerleave", onMorePointerLeave);
  moreMenu.addEventListener("pointerenter", onMorePointerEnter);
  moreMenu.addEventListener("pointerleave", onMorePointerLeave);
  mobileBtn.addEventListener("click", onMobileClick);
  mobileBackdrop.addEventListener("click", onBackdropClick);
  mobileClose.addEventListener("click", onCloseBtnClick);

  const onPopState = () => {
    closeAll();
    setActiveLinks(nav);
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    clearTimers();
    moreResizeObserver?.disconnect();
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("focusin", onFocusIn);
    nav.removeEventListener("click", onNavClickCapture, true);
    moreBtn.removeEventListener("click", onMoreClick);
    moreBtn.removeEventListener("keydown", onMoreTriggerKeyDown);
    moreMenu.removeEventListener("keydown", onMoreMenuKeyDown, true);
    moreBtn.removeEventListener("pointerenter", onMorePointerEnter);
    moreBtn.removeEventListener("pointerleave", onMorePointerLeave);
    moreMenu.removeEventListener("pointerenter", onMorePointerEnter);
    moreMenu.removeEventListener("pointerleave", onMorePointerLeave);
    clearMoreHoverClose();
    mobileBtn.removeEventListener("click", onMobileClick);
    mobileBackdrop.removeEventListener("click", onBackdropClick);
    mobileClose.removeEventListener("click", onCloseBtnClick);
    window.removeEventListener("popstate", onPopState);
    if (unlockScroll) unlockScroll();
    setClassicInert(false);
  };
}
