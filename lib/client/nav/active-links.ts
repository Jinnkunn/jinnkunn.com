import { normalizePathname } from "@/lib/routes/strategy";

export function setActiveLinks(root: HTMLElement) {
  const current = normalizePathname(window.location.pathname);
  const links = root.querySelectorAll<HTMLAnchorElement>(
    "a.super-navbar__item, a.super-navbar__list-item",
  );

  for (const a of links) {
    try {
      const href = new URL(a.href, window.location.href);
      const path = normalizePathname(href.pathname);
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

export function refreshSiteNavActiveLinks() {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  requestAnimationFrame(() => setActiveLinks(nav));
}
