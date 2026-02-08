"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type PrismModule = {
  highlightElement: (el: Element) => void;
};

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
    // Tag toggle "kind" based on its visible label, so CSS can apply typography
    // standards to special sections (e.g., references/footnotes) without relying
    // on unstable block IDs.
    const summary = t.querySelector<HTMLElement>(".notion-toggle__summary");
    const label =
      summary?.querySelector(".notion-semantic-string")?.textContent ??
      summary?.textContent ??
      "";
    const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized) {
      if (
        /(^|[\s:])(reference|references|bibliography|citations)([\s:]|$)/i.test(
          normalized,
        ) ||
        /参考文献/.test(label)
      ) {
        t.setAttribute("data-toggle-kind", "references");
      }
    }

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

function scrollToElementTop(el: HTMLElement) {
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

function initTocScrollSpy(root: ParentNode) {
  const tocs = Array.from(
    root.querySelectorAll<HTMLElement>("ul.notion-table-of-contents")
  );
  if (tocs.length === 0) return () => {};

  const getNavbarHeight = () => {
    const nav =
      document.querySelector<HTMLElement>(".notion-navbar") ??
      document.getElementById("site-nav");
    return nav ? Math.round(nav.getBoundingClientRect().height) : 0;
  };

  type TocEntry = { li: HTMLElement; id: string; a: HTMLAnchorElement | null };
  type TocState = {
    entries: TocEntry[];
    targets: string[];
    activeId: string | null;
    setActive: (id: string | null) => void;
  };

  const states: TocState[] = [];

  for (const toc of tocs) {
    const items = Array.from(
      toc.querySelectorAll<HTMLElement>(".notion-table-of-contents__item")
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

    states.push({ entries, targets, activeId, setActive });
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

      // If we haven't reached the first heading yet, keep the first item active.
      if (!best) s.setActive(s.targets[0] ?? null);
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

function initEmbeds(root: ParentNode) {
  // Super/Notion exports include an overlay loader for embeds. On the live site,
  // client scripts hide it after the iframe loads. In our static clone we need
  // to do this ourselves, otherwise embeds look "stuck loading".
  const embeds = Array.from(root.querySelectorAll<HTMLElement>(".notion-embed"));
  if (embeds.length === 0) return () => {};

  const cleanups: Array<() => void> = [];

  for (const embed of embeds) {
    const iframe = embed.querySelector<HTMLIFrameElement>("iframe");
    const loader = embed.querySelector<HTMLElement>(".notion-embed__loader");
    if (!iframe || !loader) continue;

    const markLoaded = () => {
      embed.setAttribute("data-loaded", "true");
      loader.style.display = "none";
    };

    // Some iframes may never fire `load` (blocked/slow). Prefer correctness, but
    // avoid permanently covering the content with the loader overlay.
    const fallbackTimer = window.setTimeout(() => {
      if (embed.getAttribute("data-loaded") === "true") return;
      markLoaded();
    }, 4500);

    iframe.addEventListener("load", markLoaded, { once: true });
    cleanups.push(() => {
      window.clearTimeout(fallbackTimer);
      iframe.removeEventListener("load", markLoaded);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

function getLanguageFromCodeEl(codeEl: HTMLElement): string {
  for (const cls of Array.from(codeEl.classList)) {
    if (cls.startsWith("language-")) return cls.slice("language-".length).toLowerCase();
  }
  const pre = codeEl.closest("pre");
  if (pre) {
    for (const cls of Array.from(pre.classList)) {
      if (cls.startsWith("language-")) return cls.slice("language-".length).toLowerCase();
    }
  }
  return "";
}

function normalizePrismLanguage(raw: string): string | null {
  const l = String(raw || "").trim().toLowerCase();
  if (!l) return null;

  const alias: Record<string, string> = {
    // common
    "plain": "plaintext",
    "text": "plaintext",
    "plain text": "plaintext",
    "plain-text": "plaintext",
    "plaintext": "plaintext",
    // shell
    "shell": "bash",
    "sh": "bash",
    "zsh": "bash",
    // js/ts
    "js": "javascript",
    "ts": "typescript",
    "jsx": "jsx",
    "tsx": "tsx",
    // markdown
    "md": "markdown",
    // misc
    "yml": "yaml",
    "py": "python",
  };

  return alias[l] || l;
}

const PRISM_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  // Base languages
  javascript: () => import("prismjs/components/prism-javascript"),
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: () => import("prismjs/components/prism-tsx"),

  bash: () => import("prismjs/components/prism-bash"),
  python: () => import("prismjs/components/prism-python"),
  json: () => import("prismjs/components/prism-json"),
  yaml: () => import("prismjs/components/prism-yaml"),
  toml: () => import("prismjs/components/prism-toml"),
  sql: () => import("prismjs/components/prism-sql"),
  diff: () => import("prismjs/components/prism-diff"),

  // Markdown depends on markup + others; Prism will gracefully fall back if some are missing.
  markdown: () => import("prismjs/components/prism-markdown"),
};

async function initCodeHighlighting(root: ParentNode) {
  const codeEls = Array.from(
    root.querySelectorAll<HTMLElement>("pre > code, pre > code[class*='language-']"),
  );

  const targets = codeEls.filter((codeEl) => {
    // Skip if it's already tokenized (e.g., raw Super exports).
    if (codeEl.querySelector(".token")) return false;

    const lang = normalizePrismLanguage(getLanguageFromCodeEl(codeEl));
    if (!lang) return false;
    if (lang === "plaintext") return false;
    return true;
  });

  if (targets.length === 0) return;

  let Prism: PrismModule | null = null;
  try {
    const mod = (await import("prismjs")) as unknown as PrismModule & { default?: PrismModule };
    Prism = (mod.default || mod) as PrismModule;
  } catch {
    return;
  }

  try {
    // Some Prism language components expect a global `Prism` variable.
    (window as unknown as { Prism?: PrismModule }).Prism = Prism;
  } catch {
    // ignore
  }

  const langs = new Set<string>();
  for (const el of targets) {
    const lang = normalizePrismLanguage(getLanguageFromCodeEl(el));
    if (lang) langs.add(lang);
  }

  // Load requested languages (best-effort).
  for (const lang of langs) {
    const loader = PRISM_LANGUAGE_LOADERS[lang];
    if (!loader) continue;
    try {
      await loader();
    } catch {
      // ignore missing language components
    }
  }

  // Highlight after languages are registered.
  for (const el of targets) {
    try {
      Prism.highlightElement(el);
    } catch {
      // ignore per-block errors
    }
  }
}

export default function NotionBlockBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content") ?? document;
    initToggles(root);
    const cleanupEmbeds = initEmbeds(root);
    void initCodeHighlighting(root);

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
        if (href.startsWith("#")) {
          const id = decodeHashToId(href);
          const el = id ? (document.getElementById(id) as HTMLElement | null) : null;

          // If this is a TOC jump, improve UX with smooth scroll + focus.
          const isToc = Boolean(hashLink.closest("ul.notion-table-of-contents"));

          if (id && el) {
            openToggleAncestors(el);
            if (isToc) {
              e.preventDefault();
              // Keep URL in sync without forcing the browser to jump instantly.
              try {
                history.pushState(null, "", `#${encodeURIComponent(id)}`);
              } catch {
                // ignore
              }
              scrollToElementTop(el);
              return;
            }
            // Non-TOC anchor: keep default browser behavior.
            return;
          }

          // If target doesn't exist (or is a different kind of anchor), still try revealing toggles.
          revealHashTarget(href);
        }
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
          // Home page profile photo should not be zoomable.
          if (/\/assets\/profile\.png(\?|#|$)/.test(src)) return;
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

    const cleanupTocSpy = initTocScrollSpy(root);

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
      cleanupEmbeds();
      lightboxEl.removeEventListener("click", onLightboxClick);
      closeLightbox();
    };
  }, [pathname]);

  return null;
}
