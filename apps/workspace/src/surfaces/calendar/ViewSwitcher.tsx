import type { ViewKind } from "./dateRange";
import { WorkspaceSegmentedControl } from "../../ui/primitives";

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
    <WorkspaceSegmentedControl
      label="Calendar view"
      onChange={onChange}
      options={VIEWS.map(({ id, label }) => ({ label, value: id }))}
      value={view}
    />
  );
}
