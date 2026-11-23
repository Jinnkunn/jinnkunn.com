const MANAGED_IMAGE = "img[data-cdn-image][srcset]";

export function initCdnImageFallback(root: Document | HTMLElement) {
  function restoreOriginal(image: HTMLImageElement) {
    if (image.matches(MANAGED_IMAGE) && image.getAttribute("src")) {
      // Removing the width candidates makes the browser select src again.
      // The selector also prevents retrying indefinitely if src fails.
      image.removeAttribute("srcset");
    }
  }

  function onError(event: Event) {
    if (event.target instanceof HTMLImageElement) restoreOriginal(event.target);
  }

  root.addEventListener("error", onError, true);
  // An eager image can fail before this client effect attaches.
  for (const image of root.querySelectorAll<HTMLImageElement>(MANAGED_IMAGE)) {
    if (image.complete && image.naturalWidth === 0) restoreOriginal(image);
  }

  return () => root.removeEventListener("error", onError, true);
}
