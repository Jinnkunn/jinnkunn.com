import type { CalendarPublicVisibility } from "./publicProjection";

const LABELS: Record<CalendarPublicVisibility, string> = {
  hidden: "Hidden",
  busy: "Busy",
  titleOnly: "Title",
  full: "Full",
};

export function DisclosureBadge({
  visibility,
  compact = false,
}: {
  visibility: CalendarPublicVisibility;
  compact?: boolean;
}) {
  return (
    <span
      className={
        compact
          ? "inline-flex items-center rounded px-1 py-0 text-[9px] font-semibold bg-bg-surface-alt text-text-muted"
          : "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-bg-surface-alt text-text-muted"
      }
    >
      {LABELS[visibility]}
    </span>
  );
}
