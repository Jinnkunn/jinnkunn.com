import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[data-window-drag-exclude]",
].join(",");

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

/** Starts native Tauri window dragging from custom chrome regions.
 * Browser-only dev sessions safely no-op via the rejected invoke. */
export function handleWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented) return;
  if (isInteractiveTarget(event.target)) return;
  void getCurrentWindow().startDragging().catch(() => undefined);
}
