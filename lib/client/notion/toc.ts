import { decodeHashToId } from "./toggles";

function getNavbarHeight(): number {
  const nav =
    document.querySelector<HTMLElement>(".notion-navbar") ??
    document.getElementById("site-nav");
  return nav ? Math.round(nav.getBoundingClientRect().height) : 0;
}

export function initTocScrollSpy(root: ParentNode) {
  const tocs = Array.from(
    root.querySelectorAll<HTMLElement>("ul.notion-table-of-contents"),
  );
  if (tocs.length === 0) return () => {};

  type TocEntry = { li: HTMLElement; id: string; a: HTMLAnchorElement | null };
  type TocState = {
    entries: TocEntry[];
    targets: string[];
    setActive: (id: string | null) => void;
  };

  const states: TocState[] = [];

  for (const toc of tocs) {
    const items = Array.from(
      toc.querySelectorAll<HTMLElement>(".notion-table-of-contents__item"),
    );
    const entries: TocEntry[] = [];

    for (const li of items) {
      const explicit = li.getAttribute("data-toc-target");
      const a = li.querySelector<HTMLAnchorElement>('a[href^="#"]');
      const fromHref = a ? decodeHashToId(a.getAttribute("href") || "") : null;
      const id = explicit || fromHref;
      if (!id) continue;
      entries.push({ li, id, a });
    }

    const targets = entries.map((e) => e.id).slice(0, 160);
    if (targets.length === 0) continue;

    let activeId: string | null = null;
    const setActive = (id: string | null) => {
      if (activeId === id) return;
      activeId = id;
      for (const e of entries) {
        const on = Boolean(id && e.id === id);
        e.li.setAttribute("data-active", on ? "true" : "false");
        if (e.a) {
          if (on) e.a.setAttribute("aria-current", "true");
          else e.a.removeAttribute("aria-current");
        }
      }
    };

    states.push({ entries, targets, setActive });
  }

  if (states.length === 0) return () => {};

  let raf = 0;

  const computeActive = () => {
    raf = 0;
    const offset = getNavbarHeight() + 26; // matches scroll-padding-top (+ a small cushion)
    const y = window.scrollY + offset;

    for (const s of states) {
      let best: { id: string; top: number } | null = null;
      for (const id of s.targets) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (top <= y + 1) {
          if (!best || top > best.top) best = { id, top };
        }
      }

      // If we haven't reached the first heading yet, keep TOC neutral.
      if (!best) s.setActive(null);
      else s.setActive(best.id);
    }
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

