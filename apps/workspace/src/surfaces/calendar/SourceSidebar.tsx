import type { Calendar, CalendarSource } from "./types";

/** Left rail showing every account header (EKSource) with its
 * calendars, mirroring the macOS Calendar sidebar grouping. The
 * checkbox state is owned by `CalendarSurface` so all views (Day,
 * Week, Month, Agenda) share a single filter. */
export function SourceSidebar({
  sources,
  calendarsBySource,
  selected,
  onToggle,
}: {
  sources: CalendarSource[];
  calendarsBySource: Map<string, Calendar[]>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <aside
      // Padding lives on the sidebar (not the surface-card) because the
      // adjacent timeline column wants to bleed to the card edge for
      // pixel-perfect hour gridlines. Right border separates the two
      // columns inside the same card, mirroring macOS Calendar.
      className="overflow-y-auto p-3"
      aria-label="Calendar sources"
      style={{ borderRight: "1px solid rgba(0,0,0,0.08)" }}
    >
      {sources.length === 0 ? (
        <p className="text-[12.5px] text-text-muted">
          No accounts found. Add one in System Settings → Internet Accounts.
        </p>
      ) : null}
      {sources.map((src) => {
        const cals = calendarsBySource.get(src.id) ?? [];
        if (cals.length === 0) return null;
        return (
          <section key={src.id} className="mb-4">
            <h2 className="m-0 mb-1.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold text-text-muted">
              {src.title}
            </h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
              {cals.map((cal) => (
                <li key={cal.id}>
                  <label className="flex items-center gap-2 px-1.5 py-1 rounded text-[12.5px] text-text-primary hover:bg-bg-surface-alt cursor-pointer">
                    <input
                      type="checkbox"
                      style={{ accentColor: cal.colorHex }}
                      checked={selected.has(cal.id)}
                      onChange={() => onToggle(cal.id)}
                    />
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: cal.colorHex }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{cal.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
