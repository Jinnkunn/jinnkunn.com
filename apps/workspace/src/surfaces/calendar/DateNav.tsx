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
    <div className="calendar-date-nav">
      <button
        type="button"
        className="calendar-date-nav__button"
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
        className="calendar-date-nav__today"
        onClick={() => onAnchorChange(navigateView(view, anchor, 0))}
      >
        Today
      </button>
      <button
        type="button"
        className="calendar-date-nav__button"
        onClick={() => onAnchorChange(navigateView(view, anchor, 1))}
        aria-label="Next"
      >
        <Chevron dir="right" />
      </button>
      <h2
        className="calendar-date-nav__title"
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
