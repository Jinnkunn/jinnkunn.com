"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { initEmbeds } from "@/lib/client/notion/embeds";
import { handleCopyButtonClick, initCodeHighlighting, shouldHandleCopyButtonClick } from "@/lib/client/notion/code";
import { createLightboxController, findLightboxSrcFromTarget } from "@/lib/client/notion/lightbox";
import { revealHashTarget, scrollToElementTop } from "@/lib/client/notion/anchors";
import { initTocScrollSpy } from "@/lib/client/notion/toc";
import { decodeHashToId, initToggles, openToggleAncestors, toggleFromSummaryInteraction } from "@/lib/client/notion/toggles";
export default function NotionBlockBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content") ?? document;
    initToggles(root);
    const cleanupEmbeds = initEmbeds(root);
    void initCodeHighlighting(root);
    const lightbox = createLightboxController();

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
      const copyBtn = shouldHandleCopyButtonClick(target);
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        void handleCopyButtonClick(copyBtn);
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
      e.preventDefault();

      toggleFromSummaryInteraction(summary, target);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        lightbox.close();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (!target.classList.contains("notion-toggle__summary")) return;

      e.preventDefault();
      toggleFromSummaryInteraction(target, target);
    };

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
      lightbox.cleanup();
    };
  }, [pathname]);

  return null;
}
