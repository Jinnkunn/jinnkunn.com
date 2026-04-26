import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type BlockPopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "right-start"
  | "top-start"
  | "top-center";

// A virtual anchor — used by the inline format toolbar to anchor against
// the bounding box of the current text selection rather than a DOM node.
export interface BlockPopoverRectAnchor {
  top: number;
  left: number;
  width?: number;
  height?: number;
}

export type BlockPopoverAnchor = HTMLElement | BlockPopoverRectAnchor | null;

export interface BlockPopoverProps {
  ariaLabel?: string;
  anchor: BlockPopoverAnchor;
  children: ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
  placement?: BlockPopoverPlacement;
}

const POPOVER_OFFSET = 6;

function isRectAnchor(value: unknown): value is BlockPopoverRectAnchor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BlockPopoverRectAnchor).top === "number" &&
    typeof (value as BlockPopoverRectAnchor).left === "number"
  );
}

function getAnchorRect(
  anchor: HTMLElement | BlockPopoverRectAnchor,
): DOMRect | BlockPopoverRectAnchor {
  if (isRectAnchor(anchor)) return anchor;
  return anchor.getBoundingClientRect();
}

function computePosition(
  anchor: HTMLElement | BlockPopoverRectAnchor,
  placement: BlockPopoverPlacement,
): CSSProperties {
  const r = getAnchorRect(anchor);
  const top = r.top;
  const left = r.left;
  const width = "width" in r ? r.width ?? 0 : 0;
  const height = "height" in r ? r.height ?? 0 : 0;
  const right = left + width;
  const bottom = top + height;
  if (placement === "right-start") {
    return { left: right + POPOVER_OFFSET, top };
  }
  if (placement === "bottom-end") {
    return {
      left: right,
      top: bottom + POPOVER_OFFSET,
      transform: "translateX(-100%)",
    };
  }
  if (placement === "top-start") {
    return {
      left,
      top: top - POPOVER_OFFSET,
      transform: "translateY(-100%)",
    };
  }
  if (placement === "top-center") {
    return {
      left: left + width / 2,
      top: top - POPOVER_OFFSET,
      transform: "translate(-50%, -100%)",
    };
  }
  return { left, top: bottom + POPOVER_OFFSET };
}

export function BlockPopover({
  ariaLabel,
  anchor,
  children,
  className,
  onClose,
  open,
  placement = "bottom-start",
}: BlockPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  /* eslint-disable react-hooks/set-state-in-effect -- Popover positioning is layout synchronization against measured DOM geometry. */
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    // Step 1 — initial position from the anchor + placement rule.
    const initial = computePosition(anchor, placement);
    setStyle(initial);
    // Step 2 — after the browser paints with `initial`, measure the
    // popover's actual rendered rect (post-transform) and clamp it
    // inside the viewport so toolbars near the right / bottom edge
    // don't get clipped. Single rAF is enough; the visible content
    // doesn't change between the initial paint and the corrected one
    // (the user just sees it land at the corrected spot).
    const raf = requestAnimationFrame(() => {
      const node = popoverRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const margin = 8;
      const initialLeft = typeof initial.left === "number" ? initial.left : 0;
      const initialTop = typeof initial.top === "number" ? initial.top : 0;
      let nextLeft = initialLeft;
      let nextTop = initialTop;
      if (rect.right > window.innerWidth - margin) {
        nextLeft -= rect.right - (window.innerWidth - margin);
      }
      if (rect.left < margin) {
        nextLeft += margin - rect.left;
      }
      if (rect.bottom > window.innerHeight - margin) {
        nextTop -= rect.bottom - (window.innerHeight - margin);
      }
      if (rect.top < margin) {
        nextTop += margin - rect.top;
      }
      if (nextLeft !== initialLeft || nextTop !== initialTop) {
        setStyle({ ...initial, left: nextLeft, top: nextTop });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor, open, placement]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !anchor) return;
    const handleScroll = () => {
      setStyle(computePosition(anchor, placement));
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [anchor, open, placement]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      // Only DOM-element anchors have a contains() method; rect anchors
      // (used by the inline format toolbar) intentionally don't claim any
      // DOM area, so a click outside the popover always closes it.
      if (anchor && !isRectAnchor(anchor) && anchor.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchor, onClose, open]);

  if (!open || !anchor) return null;

  return (
    <div
      aria-label={ariaLabel}
      className={["block-popover", className].filter(Boolean).join(" ")}
      ref={popoverRef}
      role="dialog"
      style={{ position: "fixed", ...style }}
    >
      {children}
    </div>
  );
}
