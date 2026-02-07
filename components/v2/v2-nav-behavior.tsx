"use client";

import { useEffect } from "react";

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

export default function V2NavBehavior() {
  useEffect(() => {
    const wrap = document.querySelector("header");
    const moreBtn = document.getElementById(
      "v2-more-trigger"
    ) as HTMLButtonElement | null;
    const more = document.getElementById("v2-more") as HTMLElement | null;

    const menuBtn = document.getElementById(
      "v2-menu-trigger"
    ) as HTMLButtonElement | null;
    const menu = document.getElementById("v2-menu") as HTMLElement | null;
    const menuClose = document.getElementById(
      "v2-menu-close"
    ) as HTMLButtonElement | null;

    if (!moreBtn || !more || !menuBtn || !menu || !menuClose) return;

    let unlock: null | (() => void) = null;
    let moreOpen = false;
    let menuOpen = false;

    const setMore = (open: boolean) => {
      moreOpen = open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
      more.hidden = !open;
      if (open) {
        setMenu(false);
        requestAnimationFrame(() => {
          (more.querySelector("a") as HTMLElement | null)?.focus();
        });
      }
    };

    const setMenu = (open: boolean) => {
      menuOpen = open;
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      menu.hidden = !open;
      if (open) {
        setMore(false);
        if (!unlock) unlock = lockBodyScroll();
        requestAnimationFrame(() => {
          (menu.querySelector("a") as HTMLElement | null)?.focus();
        });
      } else if (unlock) {
        unlock();
        unlock = null;
      }
    };

    const closeAll = () => {
      setMore(false);
      setMenu(false);
    };

    const onDocPointer = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!t) return;
      if (more.contains(t) || moreBtn.contains(t)) return;
      if (menu.contains(t) || menuBtn.contains(t)) return;
      closeAll();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const focusMenu = menuOpen;
      const focusMore = moreOpen;
      closeAll();
      if (focusMenu) menuBtn.focus();
      else if (focusMore) moreBtn.focus();
    };

    const onMoreClick = (e: MouseEvent) => {
      e.preventDefault();
      setMore(!moreOpen);
    };

    const onMenuClick = (e: MouseEvent) => {
      e.preventDefault();
      setMenu(!menuOpen);
    };

    const onCloseClick = (e: MouseEvent) => {
      e.preventDefault();
      setMenu(false);
      menuBtn.focus();
    };

    // Close drawers after navigation clicks
    const onNavClickCapture = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const a = t?.closest("a");
      if (!a) return;
      closeAll();
    };

    more.hidden = true;
    menu.hidden = true;

    document.addEventListener("pointerdown", onDocPointer, { passive: true });
    window.addEventListener("keydown", onKey);
    moreBtn.addEventListener("click", onMoreClick);
    menuBtn.addEventListener("click", onMenuClick);
    menuClose.addEventListener("click", onCloseClick);
    wrap?.addEventListener("click", onNavClickCapture, true);

    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      window.removeEventListener("keydown", onKey);
      moreBtn.removeEventListener("click", onMoreClick);
      menuBtn.removeEventListener("click", onMenuClick);
      menuClose.removeEventListener("click", onCloseClick);
      wrap?.removeEventListener("click", onNavClickCapture, true);
      if (unlock) unlock();
    };
  }, []);

  return null;
}

