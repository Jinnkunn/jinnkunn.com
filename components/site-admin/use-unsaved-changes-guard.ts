"use client";

import { useEffect } from "react";

import { shouldBlockUnsavedNavigation } from "@/lib/site-admin/unsaved-navigation";

type UseUnsavedChangesGuardInput = {
  enabled: boolean;
  message?: string;
};

const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page?";

export function useUnsavedChangesGuard(input: UseUnsavedChangesGuardInput) {
  const enabled = input.enabled;
  const message = input.message || DEFAULT_MESSAGE;

  useEffect(() => {
    if (!enabled) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (
        !shouldBlockUnsavedNavigation({
          enabled,
          currentHref: window.location.href,
          nextHref: anchor.href,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          target: anchor.target,
          download: anchor.hasAttribute("download"),
        })
      ) {
        return;
      }

      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, message]);
}
