"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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
    const open = t.classList.contains("open") || !t.classList.contains("closed");
    // If content exists, reflect state via `hidden` for a11y (CSS still controls layout).
    setToggleState(t, open);
  }
}

export default function NotionBlockBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content") ?? document;
    initToggles(root);

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

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

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [pathname]);

  return null;
}

