"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Only the hot-path modules used inside the click/keydown handlers are
// statically imported — everything else is dynamically imported from
// inside the effect and gated on DOM presence. Bundle analyzer showed
// the previous top-of-file static imports pulling ~15KB (toc + lightbox
// + embeds + code + equations) into the initial client bundle on every
// classic page even when those features weren't present on that page.
import {
  revealHashTarget,
  scrollToElementTop,
} from "@/lib/client/notion/anchors";
import {
  decodeHashToId,
  initToggles,
  openToggleAncestors,
  toggleFromSummaryInteraction,
} from "@/lib/client/notion/toggles";

type LightboxController = {
  open: (src: string) => void;
  close: () => void;
  cleanup: () => void;
};

function noopLightbox(): LightboxController {
  return { open: () => {}, close: () => {}, cleanup: () => {} };
}

export default function NotionBlockBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content") ?? document;
    initToggles(root);

    let cancelled = false;
    let cleanupEmbeds = () => {};
    let cleanupTocSpy = () => {};
    let lightbox: LightboxController = noopLightbox();

    // Synchronous lightbox fallback: if the controller hasn't resolved
    // by the time the user clicks an image, the initial click falls
    // back to the browser's default behavior and the next click picks
    // up the interactive controller.
    const hasImages = Boolean(root.querySelector(".notion-image img"));
    const hasEmbeds = Boolean(root.querySelector(".notion-embed"));
    const hasCode = Boolean(root.querySelector("pre > code"));
    const hasToc = Boolean(root.querySelector("ul.notion-table-of-contents"));
    const hasEquations = Boolean(
      root.querySelector(".notion-equation, .notion-inline-equation"),
    );

    if (hasImages) {
      void import("@/lib/client/notion/lightbox").then((mod) => {
        if (cancelled) return;
        lightbox = mod.createLightboxController();
      });
    }
    if (hasEmbeds) {
      void import("@/lib/client/notion/embeds").then((mod) => {
        if (cancelled) return;
        cleanupEmbeds = mod.initEmbeds(root);
      });
    }
    if (hasCode) {
      void import("@/lib/client/notion/code").then((mod) => {
        if (cancelled) return;
        void mod.initCodeHighlighting(root);
      });
    }
    if (hasToc) {
      void import("@/lib/client/notion/toc").then((mod) => {
        if (cancelled) return;
        cleanupTocSpy = mod.initTocScrollSpy(root);
      });
    }
    if (hasEquations) {
      void import("@/lib/client/notion/equations").then((mod) => {
        if (cancelled) return;
        mod.initInlineEquationA11y(root);
      });
    }

    let lightboxSrcResolver:
      | ((target: Element) => string | null)
      | null = null;
    let codeCopyHandler:
      | {
          should: (target: Element) => HTMLElement | null;
          handle: (btn: HTMLElement) => Promise<void> | void;
        }
      | null = null;

    if (hasImages) {
      void import("@/lib/client/notion/lightbox").then((mod) => {
        if (cancelled) return;
        lightboxSrcResolver = mod.findLightboxSrcFromTarget;
      });
    }
    if (hasCode) {
      void import("@/lib/client/notion/code").then((mod) => {
        if (cancelled) return;
        codeCopyHandler = {
          should: mod.shouldHandleCopyButtonClick,
          handle: mod.handleCopyButtonClick,
        };
      });
    }

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
      if (codeCopyHandler) {
        const copyBtn = codeCopyHandler.should(target);
        if (copyBtn) {
          e.preventDefault();
          e.stopPropagation();
          void codeCopyHandler.handle(copyBtn);
          return;
        }
      }

      // Image lightbox: click on a Notion image to open full-size.
      const isNotionImage =
        Boolean(target.closest(".notion-image")) &&
        Boolean(target.closest("img"));
      if (isNotionImage && lightboxSrcResolver) {
        const src = lightboxSrcResolver(target);
        if (src) {
          // Home page profile photo should not be zoomable.
          // We can't rely on the image URL (Notion assets vary), so use layout heuristics:
          // first column image within the home hero column list.
          const isHomeHeroProfile =
            Boolean(target.closest(".page__index")) &&
            Boolean(target.closest(".notion-column-list")) &&
            Boolean(target.closest(".notion-column")?.matches?.(":first-child")) &&
            Boolean(target.closest(".notion-image"));
          if (isHomeHeroProfile) return;
          e.preventDefault();
          e.stopPropagation();
          lightbox.open(src);
          return;
        }
      }

      const summary = target.closest(".notion-toggle__summary");
      if (!summary) return;
      if (toggleFromSummaryInteraction(summary, target)) {
        e.preventDefault();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        lightbox.close();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const trigger = target.closest(".notion-toggle__trigger");
      const isSummary = target.classList.contains("notion-toggle__summary");
      if (!isSummary && !trigger) return;
      const summary = (isSummary ? target : trigger?.closest(".notion-toggle__summary")) as
        | Element
        | null;
      if (!summary) return;

      e.preventDefault();
      const eventTarget = trigger ?? target;
      toggleFromSummaryInteraction(summary, eventTarget);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    const onHashChange = () => revealHashTarget(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    // Initial load into a deep link.
    window.setTimeout(() => revealHashTarget(window.location.hash), 0);

    return () => {
      cancelled = true;
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("hashchange", onHashChange);
      cleanupTocSpy();
      cleanupEmbeds();
      lightbox.cleanup();
    };
  }, [pathname]);

  return null;
}
