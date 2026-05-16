import type {
  CalendarPublishMetadataStore,
  CalendarPublicVisibility,
} from "./publicProjection";
import { metadataForEvent } from "./publicProjection";
import type { CalendarEvent } from "./types";
import type { diffSnapshots } from "./syncSnapshot";

export type PublishSummary = Record<CalendarPublicVisibility, number>;
export type CalendarPublishDiff = ReturnType<typeof diffSnapshots>;

export function summarizePublishVisibility(
  events: CalendarEvent[],
  store: CalendarPublishMetadataStore,
  calendarDefaults?: ReadonlyMap<string, CalendarPublicVisibility>,
  smartResolver?: (event: CalendarEvent) => CalendarPublicVisibility | null,
): PublishSummary {
  const summary: PublishSummary = {
    hidden: 0,
    busy: 0,
    titleOnly: 0,
    full: 0,
  };
  for (const event of events) {
    summary[
      metadataForEvent(store, event, calendarDefaults, smartResolver).visibility
    ] += 1;
  }
  return summary;
}

export function SyncPreviewChip({
  diff,
  hasBaseline,
}: {
  diff: CalendarPublishDiff;
  hasBaseline: boolean;
}) {
  if (!hasBaseline) {
    return (
      <span className="calendar-sync-preview" data-tone="muted">
        No previous sync
      </span>
    );
  }
  const hasChanges =
    diff.added.length + diff.visibilityChanged.length + diff.removed.length > 0;
  if (!hasChanges) {
    return (
      <span className="calendar-sync-preview" data-tone="ok">
        Up to date
      </span>
    );
  }
  return (
    <span className="calendar-sync-preview" data-tone="pending">
      {diff.added.length > 0 ? <span>+{diff.added.length}</span> : null}
      {diff.visibilityChanged.length > 0 ? (
        <span>~{diff.visibilityChanged.length}</span>
      ) : null}
      {diff.removed.length > 0 ? <span>-{diff.removed.length}</span> : null}
    </span>
  );
}
