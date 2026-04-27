import { formatViewTitle, navigateView, type ViewKind } from "./dateRange";

/** Prev / Today / Next chevrons + view-aware title. Single source of
 * truth for date navigation across Day, Week, Month, and Agenda views.
 * Per-view stride lives in `navigateView`. */
export function DateNav({
  view,
  anchor,
  onAnchorChange,
}: {
  view: ViewKind;
  anchor: Date;
  onAnchorChange: (next: Date) => void;
}) {
  const title = formatViewTitle(view, anchor);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:bg-bg-surface-alt hover:text-text-primary"
        onClick={() => onAnchorChange(navigateView(view, anchor, -1))}
        aria-label="Previous"
      >
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        // macOS-style pill: solid pale background, no border, slightly
        // wider padding than the chevrons so it reads as the primary
        // navigation action of the trio.
        className="px-3 py-1 rounded-md text-[12px] font-medium text-text-primary hover:brightness-95 transition"
        style={{ background: "rgba(0,0,0,0.05)" }}
        onClick={() => onAnchorChange(navigateView(view, anchor, 0))}
      >
        Today
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:bg-bg-surface-alt hover:text-text-primary"
        onClick={() => onAnchorChange(navigateView(view, anchor, 1))}
        aria-label="Next"
      >
        <Chevron dir="right" />
      </button>
      <h2
        className="m-0 ml-1 text-[14px] font-semibold text-text-primary tracking-[-0.01em]"
        aria-live="polite"
      >
        {title}
      </h2>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  const d =
    dir === "left"
      ? "M9.5 4 L4 9.5 L9.5 15"
      : "M5.5 4 L11 9.5 L5.5 15";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
