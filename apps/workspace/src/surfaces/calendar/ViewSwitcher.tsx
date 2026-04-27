import type { ViewKind } from "./dateRange";

const VIEWS: ReadonlyArray<{ id: ViewKind; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "agenda", label: "Agenda" },
];

/** Segmented control matching macOS Calendar's view-switcher. The
 * active button gets a filled background; the rest are transparent. */
export function ViewSwitcher({
  view,
  onChange,
}: {
  view: ViewKind;
  onChange: (next: ViewKind) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md p-0.5 gap-0.5"
      role="tablist"
      aria-label="Calendar view"
      style={{
        background: "rgba(0,0,0,0.05)",
      }}
    >
      {VIEWS.map(({ id, label }) => {
        const active = id === view;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            className={
              "px-2.5 py-0.5 rounded text-[12px] font-medium transition " +
              (active
                ? "bg-white text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                : "text-text-secondary hover:text-text-primary")
            }
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
