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

function decodeHashToId(hash: string): string | null {
  const h = (hash ?? "").trim();
  if (!h || !h.startsWith("#") || h.length < 2) return null;
  const raw = h.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    // If it's not valid URI encoding, still try the raw string.
    return raw;
  }
}

function openToggleAncestors(target: Element) {
  // Works for markup where toggle children are nested under `.notion-toggle__content`.
  // (Some Super exports don't nest children; in that case there is nothing reliable to open.)
  const toggles: HTMLElement[] = [];
  let cur: Element | null = target;
  while (cur) {
    const t = cur.closest(".notion-toggle.closed") as HTMLElement | null;
    if (!t) break;
    toggles.push(t);
    cur = t.parentElement;
  }

  // Open outer -> inner to avoid hiding inner content behind a closed parent.
  toggles.reverse();
  for (const t of toggles) setToggleState(t, true);
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = (text ?? "").replace(/\s+$/, "");
  if (!t) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through to legacy execCommand
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function setCopyButtonState(btn: HTMLElement, copied: boolean) {
  btn.setAttribute("data-copied", copied ? "true" : "false");

  // Keep this robust against Notion/Super markup variations (sometimes text is a node).
  const fallback = copied ? "Copied" : "Copy";
  const original = btn.getAttribute("data-label") || "Copy";
  if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", original);

  const desired = copied ? "Copied" : original;
  // Update the last text node if present; otherwise append a span label.
  const nodes = Array.from(btn.childNodes);
  const lastText = [...nodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE);
  if (lastText) {
    lastText.textContent = ` ${desired}`.replace(/^ /, "");
    return;
  }

  let label = btn.querySelector<HTMLElement>("[data-copy-label]");
  if (!label) {
    label = document.createElement("span");
    label.setAttribute("data-copy-label", "true");
    btn.appendChild(label);
  }
  label.textContent = fallback;
}

function initBlogTocScrollSpy() {
  const toc = document.getElementById("block-blog-toc");
  if (!toc) return () => {};

  const items = Array.from(
    toc.querySelectorAll<HTMLElement>(".notion-table-of-contents__item[data-toc-target]")
  );
  const targets = items
    .map((it) => it.getAttribute("data-toc-target"))
    .filter(Boolean) as string[];

  if (targets.length === 0) return () => {};

  const getNavbarHeight = () => {
    const nav = document.querySelector<HTMLElement>(".notion-navbar") ?? document.getElementById("site-nav");
    return nav ? Math.round(nav.getBoundingClientRect().height) : 0;
  };

  let raf = 0;
  let activeId: string | null = null;

  const setActive = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    for (const it of items) {
      const t = it.getAttribute("data-toc-target");
      const on = Boolean(id && t === id);
      it.setAttribute("data-active", on ? "true" : "false");
      const a = it.querySelector("a[href^=\"#\"]");
      if (a) {
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    }
  };

  const computeActive = () => {
    raf = 0;
    const offset = getNavbarHeight() + 26; // matches scroll-padding-top (+ a small cushion)
    const y = window.scrollY + offset;

    let best: { id: string; top: number } | null = null;
    for (const id of targets) {
      const el = document.getElementById(id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (top <= y + 1) {
        if (!best || top > best.top) best = { id, top };
      }
    }

    // If we haven't reached the first heading yet, keep the first item active.
    if (!best) setActive(targets[0] ?? null);
    else setActive(best.id);
  };

  const requestCompute = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(computeActive);
  };

  // Initial + during scroll.
  requestCompute();
  window.addEventListener("scroll", requestCompute, { passive: true });
  window.addEventListener("resize", requestCompute);

  // Images/code blocks can shift layout after hydration; re-check once everything is loaded.
  window.addEventListener("load", requestCompute, { once: true });

  return () => {
    if (raf) window.cancelAnimationFrame(raf);
    window.removeEventListener("scroll", requestCompute);
    window.removeEventListener("resize", requestCompute);
  };
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

    const revealHashTarget = (hashOrHref: string) => {
      const id = decodeHashToId(hashOrHref);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      openToggleAncestors(el);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      // In-page anchors: ensure the destination isn't inside a closed toggle.
      // We don't prevent default; this only prepares the layout before the scroll jump.
      const hashLink = target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (hashLink) {
        const href = hashLink.getAttribute("href") || "";
        if (href.startsWith("#")) revealHashTarget(href);
      }

      // Code block copy button (Notion code blocks).
      const copyBtn = target.closest<HTMLElement>(".notion-code__copy-button");
      if (copyBtn) {
        const codeRoot = copyBtn.closest(".notion-code");
        const codeEl = codeRoot?.querySelector("pre > code") ?? codeRoot?.querySelector("code");
        const text = (codeEl?.textContent ?? "").replace(/\n$/, "");

        e.preventDefault();
        e.stopPropagation();

        void (async () => {
          const ok = await copyTextToClipboard(text);
          setCopyButtonState(copyBtn, ok);
          window.setTimeout(() => setCopyButtonState(copyBtn, false), ok ? 1200 : 800);
        })();
        return;
      }

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

    const cleanupTocSpy = initBlogTocScrollSpy();

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    const onHashChange = () => revealHashTarget(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    // Initial load into a deep link.
    window.setTimeout(() => revealHashTarget(window.location.hash), 0);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("hashchange", onHashChange);
      cleanupTocSpy();
      lightboxEl.removeEventListener("click", onLightboxClick);
      closeLightbox();
    };
  }, [pathname]);

  return null;
}
