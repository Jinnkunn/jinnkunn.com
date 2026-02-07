"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function isProbablyInteractiveToggleTarget(el: Element): boolean {
  // Avoid toggling when clicking an actual link inside the summary.
  return !Boolean(el.closest("a[href]"));
}

function setToggleState(toggle: HTMLElement, open: boolean) {
  toggle.classList.toggle("open", open);
  toggle.classList.toggle("closed", !open);

  const summary = toggle.querySelector<HTMLElement>(".notion-toggle__summary");
  if (summary) {
    summary.setAttribute("role", "button");
    summary.tabIndex = 0;
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  }

  const content = toggle.querySelector<HTMLElement>(".notion-toggle__content");
  if (content) {
    content.hidden = !open;
    content.setAttribute("aria-hidden", open ? "false" : "true");
  }
}

function initToggles(root: ParentNode) {
  const toggles = Array.from(root.querySelectorAll<HTMLElement>(".notion-toggle"));
  for (const t of toggles) {
    const open = t.classList.contains("open") || !t.classList.contains("closed");
    // If content exists, reflect state via `hidden` for a11y (CSS still controls layout).
    setToggleState(t, open);
  }
}

function lockBodyScroll() {
  const { body, documentElement } = document;
  const scrollY = window.scrollY || documentElement.scrollTop || 0;
  const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);

  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };

  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

  return () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;
    body.style.paddingRight = prev.paddingRight;
    window.scrollTo(0, scrollY);
  };
}

function ensureLightbox(): {
  el: HTMLElement;
  img: HTMLImageElement;
  closeBtn: HTMLButtonElement;
} {
  const existing = document.getElementById("notion-lightbox");
  if (existing) {
    const img = existing.querySelector("img") as HTMLImageElement | null;
    const closeBtn = existing.querySelector(
      "button"
    ) as HTMLButtonElement | null;
    if (img && closeBtn) return { el: existing, img, closeBtn };
  }

  const el = document.createElement("div");
  el.id = "notion-lightbox";
  el.className = "notion-lightbox";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Image preview");
  el.setAttribute("data-open", "false");

  el.innerHTML = `
    <div class="notion-lightbox__surface">
      <button type="button" class="notion-lightbox__close" aria-label="Close">×</button>
      <img class="notion-lightbox__img" alt="" />
    </div>
  `;

  document.body.appendChild(el);

  const img = el.querySelector("img") as HTMLImageElement;
  const closeBtn = el.querySelector("button") as HTMLButtonElement;
  return { el, img, closeBtn };
}

function findLightboxSrcFromTarget(target: Element): string | null {
  const holder = target.closest("[data-lightbox-src],[data-full-size]");
  if (holder) {
    const src =
      holder.getAttribute("data-lightbox-src") ||
      holder.getAttribute("data-full-size");
    if (src) return src;
  }

  const img = target.closest("img");
  if (img && img instanceof HTMLImageElement) {
    return img.currentSrc || img.src || null;
  }
  return null;
}

export default function NotionBlockBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content") ?? document;
    initToggles(root);

    const { el: lightboxEl, img: lightboxImg, closeBtn } = ensureLightbox();
    let unlockScroll: null | (() => void) = null;
    let lastFocus: HTMLElement | null = null;

    const closeLightbox = () => {
      if (lightboxEl.getAttribute("data-open") !== "true") return;
      lightboxEl.setAttribute("data-open", "false");
      lightboxImg.removeAttribute("src");
      lightboxImg.alt = "";
      if (unlockScroll) {
        unlockScroll();
        unlockScroll = null;
      }
      if (lastFocus) lastFocus.focus();
      lastFocus = null;
    };

    const openLightbox = (src: string) => {
      lastFocus = document.activeElement as HTMLElement | null;
      lightboxImg.src = src;
      lightboxEl.setAttribute("data-open", "true");
      if (!unlockScroll) unlockScroll = lockBodyScroll();
      closeBtn.focus();
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      // Image lightbox: click on a Notion image to open full-size.
      const isNotionImage =
        Boolean(target.closest(".notion-image")) &&
        Boolean(target.closest("img"));
      if (isNotionImage) {
        const src = findLightboxSrcFromTarget(target);
        if (src) {
          e.preventDefault();
          e.stopPropagation();
          openLightbox(src);
          return;
        }
      }

      const summary = target.closest(".notion-toggle__summary");
      if (!summary) return;
      if (!isProbablyInteractiveToggleTarget(target)) return;

      const toggle = summary.closest<HTMLElement>(".notion-toggle");
      if (!toggle) return;
      e.preventDefault();

      const open = toggle.classList.contains("closed");
      setToggleState(toggle, open);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeLightbox();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (!target.classList.contains("notion-toggle__summary")) return;
      if (!isProbablyInteractiveToggleTarget(target)) return;

      const toggle = target.closest<HTMLElement>(".notion-toggle");
      if (!toggle) return;
      e.preventDefault();

      const open = toggle.classList.contains("closed");
      setToggleState(toggle, open);
    };

    const onLightboxClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      // Close if clicking outside the surface, or on the close button.
      if (t.classList.contains("notion-lightbox__close")) return closeLightbox();
      if (t.closest(".notion-lightbox__surface")) return;
      closeLightbox();
    };

    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeLightbox();
    });
    lightboxEl.addEventListener("click", onLightboxClick);

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      lightboxEl.removeEventListener("click", onLightboxClick);
      closeLightbox();
    };
  }, [pathname]);

  return null;
}
