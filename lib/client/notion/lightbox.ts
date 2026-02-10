import { lockBodyScroll } from "@/lib/client/dom-utils";

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

export function findLightboxSrcFromTarget(target: Element): string | null {
  const holder = target.closest("[data-lightbox-src],[data-full-size]");
  if (holder) {
    const src = holder.getAttribute("data-lightbox-src") || holder.getAttribute("data-full-size");
    if (src) return src;
  }

  const img = target.closest("img");
  if (img && img instanceof HTMLImageElement) return img.currentSrc || img.src || null;
  return null;
}

export function createLightboxController() {
  const { el: lightboxEl, img: lightboxImg, closeBtn } = ensureLightbox();
  let unlockScroll: null | (() => void) = null;
  let lastFocus: HTMLElement | null = null;

  const close = () => {
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

  const open = (src: string) => {
    lastFocus = document.activeElement as HTMLElement | null;
    lightboxImg.src = src;
    lightboxEl.setAttribute("data-open", "true");
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

  closeBtn.addEventListener("click", onCloseClick as any);
  lightboxEl.addEventListener("click", onBackdropClick);

  return {
    el: lightboxEl,
    closeBtn,
    open,
    close,
    cleanup: () => {
      lightboxEl.removeEventListener("click", onBackdropClick);
      closeBtn.removeEventListener("click", onCloseClick as any);
      close();
    },
  };
}

