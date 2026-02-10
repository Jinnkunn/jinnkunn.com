import { decodeHashToId, openToggleAncestors } from "./toggles";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}

function getNavbarHeightPx(): number {
  const nav =
    document.querySelector<HTMLElement>(".notion-navbar") ??
    document.getElementById("site-nav");
  return nav ? Math.round(nav.getBoundingClientRect().height) : 0;
}

function focusAfterScroll(el: HTMLElement) {
  // Keep `tabindex="-1"` so focus sticks (removing tabindex from a focused element can blur it).
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

function flashAnchorTarget(el: HTMLElement) {
  // Subtle arrival feedback after TOC jumps / deep links.
  // Implemented as a transient data-attribute so CSS can animate it.
  if (prefersReducedMotion()) return;
  el.setAttribute("data-anchor-flash", "true");
  window.setTimeout(() => {
    // If navigation happened, `el` might be gone; guard via try/catch.
    try {
      el.removeAttribute("data-anchor-flash");
    } catch {
      // ignore
    }
  }, 950);
}

export function scrollToElementTop(el: HTMLElement) {
  const offset = getNavbarHeightPx() + 24;
  const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  window.scrollTo({ top, behavior });

  // Cross-browser `scrollend` isn't reliable; settle by polling a short window.
  const deadline = Date.now() + (behavior === "smooth" ? 900 : 0);
  const tick = () => {
    const remaining = Math.abs(window.scrollY - top);
    if (remaining < 2 || Date.now() >= deadline) {
      flashAnchorTarget(el);
      focusAfterScroll(el);
      return;
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

export function revealHashTarget(hashOrHref: string) {
  const id = decodeHashToId(hashOrHref);
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  openToggleAncestors(el);
}

