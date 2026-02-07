"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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

function lockBodyScroll() {
  const { body, documentElement } = document;
  const scrollY = window.scrollY || documentElement.scrollTop || 0;

  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };

  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";

  return () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;
    window.scrollTo(0, scrollY);
  };
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

    if (!moreBtn || !moreMenu || !mobileBtn || !mobileMenu) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    let moreOpen = false;
    let mobileOpen = false;
    let unlockScroll: null | (() => void) = null;
    let moreCloseTimer: number | null = null;
    let mobileCloseTimer: number | null = null;

    const clearTimers = () => {
      if (moreCloseTimer) window.clearTimeout(moreCloseTimer);
      if (mobileCloseTimer) window.clearTimeout(mobileCloseTimer);
      moreCloseTimer = null;
      mobileCloseTimer = null;
    };

    const setMoreOpen = (open: boolean) => {
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
        // Focus the first item for keyboard users.
        if (!prefersReducedMotion) {
          requestAnimationFrame(() => {
            const first = moreMenu.querySelector<HTMLElement>(
              "a.super-navbar__list-item"
            );
            first?.focus();
          });
        }
      } else {
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

    const setMobileOpen = (open: boolean) => {
      if (mobileOpen === open) return;
      mobileOpen = open;
      mobileBtn.setAttribute("aria-expanded", open ? "true" : "false");

      clearTimers();

      if (open) {
        // Ensure the other menu is closed.
        setMoreOpen(false);

        mobileMenu.hidden = false;
        mobileMenu.removeAttribute("inert");

        mobileMenu.classList.remove("exit", "exit-active");
        mobileMenu.classList.add("enter");
        requestAnimationFrame(() => {
          mobileMenu.classList.remove("enter");
          mobileMenu.classList.add("enter-done");
        });

        if (!unlockScroll) unlockScroll = lockBodyScroll();

        requestAnimationFrame(() => {
          const first = mobileMenu.querySelector<HTMLElement>(
            "a.super-navbar__item"
          );
          first?.focus();
        });
      } else {
        mobileMenu.setAttribute("inert", "");
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
      }
    };

    const closeAll = () => {
      setMoreOpen(false);
      setMobileOpen(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && nav.contains(e.target)) return;
      closeAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && mobileOpen) {
        // Focus trap for the mobile menu.
        const focusables = Array.from(
          mobileMenu.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          const s = window.getComputedStyle(el);
          return s.visibility !== "hidden" && s.display !== "none";
        });

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
      if (focusMobile) mobileBtn.focus();
      else if (focusMore) moreBtn.focus();
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
      setMoreOpen(!moreOpen);
    };

    const onMobileClick = (e: MouseEvent) => {
      e.preventDefault();
      setMobileOpen(!mobileOpen);
    };

    // Initial state
    moreMenu.style.display = "none";
    moreMenu.setAttribute("data-state", "closed");
    moreMenu.setAttribute("inert", "");
    moreBtn.setAttribute("aria-expanded", "false");
    mobileBtn.setAttribute("aria-expanded", "false");
    mobileMenu.hidden = true;
    mobileMenu.setAttribute("inert", "");
    setActiveLinks(nav);

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    nav.addEventListener("click", onNavClickCapture, true);
    moreBtn.addEventListener("click", onMoreClick);
    mobileBtn.addEventListener("click", onMobileClick);

    // Update active classes on client-side navigations (best-effort).
    const onPopState = () => setActiveLinks(nav);
    window.addEventListener("popstate", onPopState);

    return () => {
      clearTimers();
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      nav.removeEventListener("click", onNavClickCapture, true);
      moreBtn.removeEventListener("click", onMoreClick);
      mobileBtn.removeEventListener("click", onMobileClick);
      window.removeEventListener("popstate", onPopState);
      if (unlockScroll) unlockScroll();
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
