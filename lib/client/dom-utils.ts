"use client";

type ScrollLockState = {
  scrollY: number;
  prev: {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
    htmlOverflow: string;
    paddingRight: string;
  };
};

let __scrollLocks = 0;
let __scrollState: ScrollLockState | null = null;

export function lockBodyScroll(): () => void {
  const { body, documentElement } = document;

  // Ref-count to avoid breaking nested overlays (e.g., menu + lightbox).
  if (__scrollLocks === 0) {
    const scrollY = window.scrollY || documentElement.scrollTop || 0;
    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);

    __scrollState = {
      scrollY,
      prev: {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        htmlOverflow: documentElement.style.overflow,
        paddingRight: body.style.paddingRight,
      },
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  }

  __scrollLocks += 1;

  return () => {
    __scrollLocks = Math.max(0, __scrollLocks - 1);
    if (__scrollLocks !== 0) return;
    const state = __scrollState;
    __scrollState = null;
    if (!state) return;

    body.style.position = state.prev.position;
    body.style.top = state.prev.top;
    body.style.left = state.prev.left;
    body.style.right = state.prev.right;
    body.style.width = state.prev.width;
    body.style.overflow = state.prev.overflow;
    document.documentElement.style.overflow = state.prev.htmlOverflow;
    body.style.paddingRight = state.prev.paddingRight;
    window.scrollTo(0, state.scrollY);
  };
}

export function setInert(el: HTMLElement, inert: boolean): void {
  if (inert) {
    el.setAttribute("inert", "");
    el.setAttribute("aria-hidden", "true");
  } else {
    el.removeAttribute("inert");
    el.removeAttribute("aria-hidden");
  }
}

export function setInertMany(els: Iterable<HTMLElement>, inert: boolean): void {
  for (const el of els) setInert(el, inert);
}

export function getClassicInertTargets(): HTMLElement[] {
  // Classic layout: keep dialogs usable while preventing background interaction.
  const main = document.getElementById("main-content");
  const skip = document.querySelector<HTMLElement>(".skip-link");
  const footer = document.querySelector<HTMLElement>("footer.super-footer");
  return [skip, main, footer].filter(Boolean) as HTMLElement[];
}

export function setClassicInert(open: boolean): void {
  setInertMany(getClassicInertTargets(), open);
}

export function isTypingContext(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  if (el.closest("[contenteditable='true']")) return true;
  const tag = el.tagName?.toLowerCase?.() || "";
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function getFocusable(container: HTMLElement, opts?: { exclude?: (el: HTMLElement) => boolean }): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex=\"-1\"])'),
  );

  return candidates
    .filter((el) => {
      if (opts?.exclude?.(el)) return false;
      if (el.getAttribute("tabindex") === "-1") return false;
      const s = window.getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      return true;
    })
    .filter((el) => container.contains(el));
}

export function createFocusTrap(container: HTMLElement, opts?: { exclude?: (el: HTMLElement) => boolean; fallback?: HTMLElement | null }) {
  const focusFirst = () => {
    const items = getFocusable(container, { exclude: opts?.exclude });
    (items[0] ?? opts?.fallback)?.focus?.();
  };
  const focusLast = () => {
    const items = getFocusable(container, { exclude: opts?.exclude });
    (items[items.length - 1] ?? opts?.fallback)?.focus?.();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = getFocusable(container, { exclude: opts?.exclude });
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!active || active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!active || active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    const t = e.target instanceof Node ? e.target : null;
    if (!t) return;
    if (container.contains(t)) return;
    focusFirst();
  };

  return { focusFirst, focusLast, onKeyDown, onFocusIn };
}
