import { createFocusTrap, lockBodyScroll, setClassicInert } from "@/lib/client/dom-utils";

// Marks an image that has been wired up as a lightbox trigger. It doubles as the styling hook
// for the focus ring (the image itself is the focusable control — its `data-lightbox-src`
// wrapper is `display:contents` and therefore generates no box to draw an outline around).
const LIGHTBOX_TRIGGER_ATTR = "data-lightbox-trigger";

export type LightboxSource = { src: string; alt: string };

export function ensureLightbox(): {
  el: HTMLElement;
  img: HTMLImageElement;
  closeBtn: HTMLButtonElement;
} {
  const existing = document.getElementById("notion-lightbox");
  if (existing) {
    const img = existing.querySelector("img") as HTMLImageElement | null;
    const closeBtn = existing.querySelector("button") as HTMLButtonElement | null;
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
      <button type="button" class="notion-lightbox__close" aria-label="Close">
        <span class="sr-only">Close</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
      <img class="notion-lightbox__img" alt="" />
    </div>
  `;

  document.body.appendChild(el);

  const img = el.querySelector("img") as HTMLImageElement;
  const closeBtn = el.querySelector("button") as HTMLButtonElement;
  return { el, img, closeBtn };
}

// Bridge for the click path: `components/notion-block-behavior.tsx` still resolves the source
// through `findLightboxSrcFromTarget()` (a bare string) and then calls `open(src)`, which would
// drop the alt text again. Remember the last resolution and reuse it when `open()` is called
// without an explicit alt for the same src. Delete once that call site adopts
// `findLightboxSourceFromTarget()`.
let lastResolvedSource: LightboxSource | null = null;

export function findLightboxSourceFromTarget(target: Element): LightboxSource | null {
  const img = target.closest("img");
  // The alt always comes from the *source* image; the enlarged copy is the same picture.
  const alt = img instanceof HTMLImageElement ? img.alt : "";

  const holder = target.closest("[data-lightbox-src],[data-full-size]");
  if (holder) {
    const src = holder.getAttribute("data-lightbox-src") || holder.getAttribute("data-full-size");
    if (src) {
      lastResolvedSource = { src, alt };
      return lastResolvedSource;
    }
  }

  if (img instanceof HTMLImageElement) {
    const src = img.currentSrc || img.src || "";
    if (src) {
      lastResolvedSource = { src, alt };
      return lastResolvedSource;
    }
  }
  return null;
}

export function findLightboxSrcFromTarget(target: Element): string | null {
  return findLightboxSourceFromTarget(target)?.src ?? null;
}

/**
 * The home hero portrait is deliberately not zoomable. Its URL can't be used to detect it
 * (Notion asset URLs rotate), so this is the layout heuristic the click path already relies on:
 * the first column's image inside the home page's hero column list. Exported so the click path
 * and the keyboard path share one definition instead of drifting apart.
 */
export function isHomeHeroProfileImage(target: Element): boolean {
  return (
    Boolean(target.closest(".page__index")) &&
    Boolean(target.closest(".notion-column-list")) &&
    Boolean(target.closest(".notion-column")?.matches?.(":first-child")) &&
    Boolean(target.closest(".notion-image"))
  );
}

function resolveScope(root?: ParentNode | null): Document | HTMLElement {
  if (root instanceof HTMLElement || root instanceof Document) return root;
  return document.getElementById("main-content") ?? document;
}

export function createLightboxController(root?: ParentNode | null) {
  const scope = resolveScope(root);
  const { el: lightboxEl, img: lightboxImg, closeBtn } = ensureLightbox();
  // The lightbox is a modal dialog, so Tab must not escape it. `setClassicInert` only inerts
  // the skip link, #main-content and the footer *inside* .super-root — the lightbox itself
  // lives at body level, so it stays interactive.
  const trap = createFocusTrap(lightboxEl, { fallback: closeBtn });
  let unlockScroll: null | (() => void) = null;
  let lastFocus: HTMLElement | null = null;
  const triggers: HTMLElement[] = [];

  const isOpen = () => lightboxEl.getAttribute("data-open") === "true";

  const close = () => {
    if (!isOpen()) return;
    lightboxEl.setAttribute("data-open", "false");
    lightboxImg.removeAttribute("src");
    lightboxImg.alt = "";
    // Lift the background inert *before* restoring focus: the element we came from normally
    // lives inside #main-content, and focus() is a no-op while that subtree is inert.
    setClassicInert(false);
    if (unlockScroll) {
      unlockScroll();
      unlockScroll = null;
    }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  };

  const open = (src: string, alt?: string) => {
    lastFocus = document.activeElement as HTMLElement | null;
    lightboxImg.src = src;
    // A hardcoded empty alt announced the dialog as containing nothing at all.
    lightboxImg.alt =
      alt ?? (lastResolvedSource?.src === src ? lastResolvedSource.alt : "");
    lightboxEl.setAttribute("data-open", "true");
    setClassicInert(true);
    if (!unlockScroll) unlockScroll = lockBodyScroll();
    closeBtn.focus();
  };

  const onBackdropClick = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    // Close if clicking outside the surface, or on the close button.
    if (t.classList.contains("notion-lightbox__close")) return close();
    if (t.closest(".notion-lightbox__surface")) return;
    close();
  };

  const onCloseClick = (e: MouseEvent) => {
    e.preventDefault();
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Tab") trap.onKeyDown(e);
      return;
    }

    // Keyboard entry point: the lightbox used to be mouse-only.
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target instanceof Element ? e.target : null;
    const trigger = target?.closest<HTMLElement>(`[${LIGHTBOX_TRIGGER_ATTR}="true"]`);
    if (!trigger) return;
    const source = findLightboxSourceFromTarget(trigger);
    if (!source) return;
    e.preventDefault();
    open(source.src, source.alt);
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!isOpen()) return;
    trap.onFocusIn(e);
  };

  const prepareTriggers = () => {
    for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>(".notion-image img"))) {
      if (isHomeHeroProfileImage(img)) continue;
      if (img.getAttribute(LIGHTBOX_TRIGGER_ATTR) === "true") continue;
      img.setAttribute(LIGHTBOX_TRIGGER_ATTR, "true");
      // The image *is* the control; its alt supplies the accessible name.
      img.setAttribute("role", "button");
      img.setAttribute("aria-haspopup", "dialog");
      img.setAttribute("tabindex", "0");
      triggers.push(img);
    }
  };

  const releaseTriggers = () => {
    for (const img of triggers) {
      img.removeAttribute(LIGHTBOX_TRIGGER_ATTR);
      img.removeAttribute("role");
      img.removeAttribute("aria-haspopup");
      img.removeAttribute("tabindex");
    }
    triggers.length = 0;
  };

  prepareTriggers();
  closeBtn.addEventListener("click", onCloseClick);
  lightboxEl.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn, true);

  return {
    el: lightboxEl,
    closeBtn,
    open,
    close,
    cleanup: () => {
      lightboxEl.removeEventListener("click", onBackdropClick);
      closeBtn.removeEventListener("click", onCloseClick);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn, true);
      releaseTriggers();
      close();
    },
  };
}
