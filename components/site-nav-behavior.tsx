"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { lockBodyScroll } from "@/lib/client/dom-utils";

function normalizePath(p: string): string {
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function setActiveLinks(root: HTMLElement) {
  const current = normalizePath(window.location.pathname);

  const links = root.querySelectorAll<HTMLAnchorElement>(
    "a.super-navbar__item, a.super-navbar__list-item"
  );

  for (const a of links) {
    try {
      const href = new URL(a.href, window.location.href);
      const path = normalizePath(href.pathname);
      if (path === current) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      } else {
        a.classList.remove("active");
        a.removeAttribute("aria-current");
      }
    } catch {
      // ignore invalid URLs
    }
  }
}

function setBackgroundInert(open: boolean) {
  // Keep the dialog usable while preventing background focus/scroll/interaction.
  // We target only obvious siblings of the navbar in the classic layout.
  const main = document.getElementById("main-content");
  const skip = document.querySelector<HTMLElement>(".skip-link");
  const footer = document.querySelector<HTMLElement>("footer.super-footer");
  const targets = [skip, main, footer].filter(Boolean) as HTMLElement[];

  for (const el of targets) {
    if (open) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  }
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  );

  return candidates
    .filter((el) => {
      // Exclude the invisible full-screen close backdrop from tab order.
      if (el.id === "mobile-backdrop") return false;
      // Exclude explicitly non-tabbable elements.
      if (el.getAttribute("tabindex") === "-1") return false;
      const s = window.getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      return true;
    })
    .filter((el) => container.contains(el));
}

export default function SiteNavBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const nav = document.getElementById("site-nav");
    if (!nav) return;

    const moreBtn = document.getElementById(
      "more-trigger"
    ) as HTMLButtonElement | null;
    const moreMenu = document.getElementById("more-menu") as HTMLElement | null;

    const mobileBtn = document.getElementById(
      "mobile-trigger"
    ) as HTMLButtonElement | null;
    const mobileMenu = document.getElementById(
      "mobile-menu"
    ) as HTMLElement | null;
    const mobileBackdrop = document.getElementById(
      "mobile-backdrop"
    ) as HTMLButtonElement | null;
    const mobileClose = document.getElementById(
      "mobile-close"
    ) as HTMLButtonElement | null;
    const mobileDialog = mobileMenu?.querySelector(
      ".super-navbar__menu"
    ) as HTMLElement | null;

    if (
      !moreBtn ||
      !moreMenu ||
      !mobileBtn ||
      !mobileMenu ||
      !mobileBackdrop ||
      !mobileClose ||
      !mobileDialog
    )
      return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    let moreOpen = false;
    let mobileOpen = false;
    let unlockScroll: null | (() => void) = null;
    let moreCloseTimer: number | null = null;
    let mobileCloseTimer: number | null = null;
    let mobilePrevFocus: HTMLElement | null = null;
    let moreResizeObserver: ResizeObserver | null = null;

    const getMoreItems = () =>
      Array.from(
        moreMenu.querySelectorAll<HTMLElement>("a.super-navbar__list-item")
      );

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

    const setMoreOpen = (
      open: boolean,
      opts: { focus?: "first" | "last" } = {}
    ) => {
      if (moreOpen === open) return;
      moreOpen = open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");

      clearTimers();

      if (open) {
        // Ensure the other menu is closed.
        setMobileOpen(false);

        moreMenu.style.display = "";
        moreMenu.setAttribute("data-state", "open");
        moreMenu.removeAttribute("inert");
        // Dynamic height: size the dropdown based on the *rendered* list height.
        // NOTE: `.super-navbar__list-content` has `max-height` + `overflow:auto`, so
        // `scrollHeight` can be larger than what is actually rendered, causing a
        // too-tall dropdown. Use `getBoundingClientRect().height` instead.
        const syncMoreHeight = () => {
          const content = moreMenu.querySelector<HTMLElement>(
            ".super-navbar__list-content"
          );
          if (!content) return;
          const rect = content.getBoundingClientRect();
          const h = Math.max(0, Math.ceil(rect.height));
          moreMenu.style.setProperty(
            "--radix-navigation-menu-viewport-height",
            `${h}px`
          );
        };

        requestAnimationFrame(() => {
          syncMoreHeight();
          // Keep height correct across responsive reflows / font swaps while open.
          const content = moreMenu.querySelector<HTMLElement>(
            ".super-navbar__list-content"
          );
          if (content && typeof ResizeObserver !== "undefined") {
            moreResizeObserver?.disconnect();
            moreResizeObserver = new ResizeObserver(() => syncMoreHeight());
            moreResizeObserver.observe(content);
          }
        });
        // Only move focus when explicitly requested (keyboard open).
        if (opts.focus) requestAnimationFrame(() => focusMoreItem(opts.focus!));
      } else {
        moreResizeObserver?.disconnect();
        moreMenu.setAttribute("data-state", "closed");
        moreMenu.setAttribute("inert", "");
        if (prefersReducedMotion) {
          moreMenu.style.display = "none";
        } else {
          // Let fadeOut play, then remove from flow/pointer-events.
          moreCloseTimer = window.setTimeout(() => {
            moreMenu.style.display = "none";
          }, 220);
        }
      }
    };

    const setMobileOpen = (
      open: boolean,
      opts: { restoreFocus?: boolean } = {}
    ) => {
      if (mobileOpen === open) return;
      mobileOpen = open;
      mobileBtn.setAttribute("aria-expanded", open ? "true" : "false");

      clearTimers();

      if (open) {
        // Ensure the other menu is closed.
        setMoreOpen(false);

        mobilePrevFocus = document.activeElement as HTMLElement | null;
        mobileMenu.hidden = false;
        mobileMenu.removeAttribute("inert");
        mobileMenu.setAttribute("data-state", "open");
        setBackgroundInert(true);

        mobileMenu.classList.remove("exit", "exit-active");
        mobileMenu.classList.add("enter");
        requestAnimationFrame(() => {
          mobileMenu.classList.remove("enter");
          mobileMenu.classList.add("enter-done");
        });

        if (!unlockScroll) unlockScroll = lockBodyScroll();

        requestAnimationFrame(() => {
          const focusables = getFocusable(mobileDialog);
          (focusables[0] ?? mobileClose ?? mobileBtn)?.focus?.();
        });
      } else {
        mobileMenu.setAttribute("inert", "");
        mobileMenu.setAttribute("data-state", "closed");
        setBackgroundInert(false);
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
            (mobilePrevFocus && document.contains(mobilePrevFocus)
              ? mobilePrevFocus
              : mobileBtn) ?? mobileBtn;
          requestAnimationFrame(() => toFocus?.focus?.());
        }
        mobilePrevFocus = null;
      }
    };

    const closeAll = () => {
      setMoreOpen(false);
      setMobileOpen(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!t) return closeAll();

      // If mobile menu is open, allow "tap outside" inside the nav wrapper
      // (on the backdrop area) to close it.
      if (mobileOpen) {
        if (mobileBtn.contains(t) || mobileDialog.contains(t)) return;
        // Clicked somewhere else (including the backdrop) -> close.
        return setMobileOpen(false, { restoreFocus: true });
      }

      // If "More" is open, close it when clicking outside its button/menu,
      // even if still inside the navbar region.
      if (moreOpen) {
        if (moreBtn.contains(t) || moreMenu.contains(t)) return;
        return setMoreOpen(false);
      }

      // Otherwise, only close menus when clicking outside the nav entirely.
      if (nav.contains(t)) return;
      closeAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && mobileOpen) {
        // Focus trap for the mobile menu.
        const focusables = getFocusable(mobileDialog);

        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement as HTMLElement | null;
          if (e.shiftKey) {
            if (!active || active === first || !mobileMenu.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (!active || active === last || !mobileMenu.contains(active)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
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
      const t = e.target instanceof Node ? e.target : null;
      if (!t) return;
      if (mobileDialog.contains(t)) return;
      // If focus escapes (e.g., iOS + external keyboard quirks), pull it back.
      const focusables = getFocusable(mobileDialog);
      (focusables[0] ?? mobileClose ?? mobileBtn)?.focus?.();
    };

    const onNavClickCapture = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const a = t?.closest("a");
      if (!a) return;
      // Close on navigation clicks (internal links).
      closeAll();
    };

    const onMoreClick = (e: MouseEvent) => {
      e.preventDefault();
      // Clicking should NOT steal focus into the menu.
      setMoreOpen(!moreOpen);
    };

    // Desktop UX: open "More" on hover (mouse), while keeping click/touch behavior unchanged.
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
        // Close the menu as focus leaves naturally.
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

    // Initial state
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

    // Update active classes on client-side navigations (best-effort).
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
      setBackgroundInert(false);
    };
  }, []);

  // Keep active link highlighting correct on App Router client navigations.
  useEffect(() => {
    const nav = document.getElementById("site-nav");
    if (!nav) return;
    // Defer one frame so DOM reflects the latest navigation state.
    requestAnimationFrame(() => setActiveLinks(nav));
  }, [pathname]);

  return null;
}
