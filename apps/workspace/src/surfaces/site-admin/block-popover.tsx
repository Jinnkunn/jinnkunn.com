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
  | "top-start";

export interface BlockPopoverProps {
  ariaLabel?: string;
  anchor: HTMLElement | null;
  children: ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
  placement?: BlockPopoverPlacement;
}

const POPOVER_OFFSET = 6;

function computePosition(
  anchor: HTMLElement,
  placement: BlockPopoverPlacement,
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  if (placement === "right-start") {
    return {
      left: rect.right + POPOVER_OFFSET,
      top: rect.top,
    };
  }
  if (placement === "bottom-end") {
    return {
      left: rect.right,
      top: rect.bottom + POPOVER_OFFSET,
      transform: "translateX(-100%)",
    };
  }
  if (placement === "top-start") {
    return {
      left: rect.left,
      top: rect.top - POPOVER_OFFSET,
      transform: "translateY(-100%)",
    };
  }
  return {
    left: rect.left,
    top: rect.bottom + POPOVER_OFFSET,
  };
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

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    setStyle(computePosition(anchor, placement));
  }, [anchor, open, placement]);

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
      if (anchor?.contains(target)) return;
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
