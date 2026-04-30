// Snapshot of what was last sent up to /api/site-admin/sync (the
// public calendar projection). Stored in localStorage so the
// workspace can compute a diff between "what's about to publish"
// and "what's currently live" before the operator clicks Sync.
//
// We deliberately keep only the surface fields the operator cares
// about for diffing — id + visibility + title — instead of the
// whole payload. That keeps the storage footprint tiny (~50 bytes
// per event) and makes the diff cheap (compare two Maps).

import type { CalendarPublicVisibility } from "./publicProjection";

// The snapshot stores the same three visibility levels the public
// projection actually emits — the workspace's internal "hidden"
// state never reaches the projection (those events are filtered
// out at projection time), so the snapshot type narrows accordingly.
type PublicCalendarVisibility = Exclude<CalendarPublicVisibility, "hidden">;

const STORAGE_KEY = "workspace.calendar.lastSyncedProjection.v1";

export interface SnapshotEventEntry {
  id: string;
  title: string;
  visibility: PublicCalendarVisibility;
}

export interface SyncSnapshot {
  syncedAt: string;
  events: SnapshotEventEntry[];
}

export function loadSyncSnapshot(): SyncSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncSnapshot>;
    if (!parsed || typeof parsed.syncedAt !== "string") return null;
    if (!Array.isArray(parsed.events)) return null;
    const events: SnapshotEventEntry[] = parsed.events
      .filter((entry): entry is SnapshotEventEntry =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            typeof entry.title === "string" &&
            (entry.visibility === "busy" ||
              entry.visibility === "titleOnly" ||
              entry.visibility === "full"),
        ),
      )
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        visibility: entry.visibility,
      }));
    return { syncedAt: parsed.syncedAt, events };
  } catch {
    return null;
  }
}

export function saveSyncSnapshot(snapshot: SyncSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota / private mode — degrade silently. The diff just shows
    // every event as "new" until the next successful save lands.
  }
}

export interface SyncDiff {
  added: SnapshotEventEntry[];
  removed: SnapshotEventEntry[];
  visibilityChanged: Array<{
    id: string;
    title: string;
    from: PublicCalendarVisibility;
    to: PublicCalendarVisibility;
  }>;
  unchanged: number;
}

/** Diff the next-to-publish projection against the last-synced snapshot.
 * Empty `previous` (first sync ever) means everything is "added". */
export function diffSnapshots(
  next: ReadonlyArray<SnapshotEventEntry>,
  previous: ReadonlyArray<SnapshotEventEntry>,
): SyncDiff {
  const prevById = new Map(previous.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const added: SnapshotEventEntry[] = [];
  const visibilityChanged: SyncDiff["visibilityChanged"] = [];
  let unchanged = 0;
  for (const entry of next) {
    seen.add(entry.id);
    const previousEntry = prevById.get(entry.id);
    if (!previousEntry) {
      added.push(entry);
      continue;
    }
    if (previousEntry.visibility !== entry.visibility) {
      visibilityChanged.push({
        id: entry.id,
        title: entry.title,
        from: previousEntry.visibility,
        to: entry.visibility,
      });
      continue;
    }
    unchanged += 1;
  }
  const removed = previous.filter((entry) => !seen.has(entry.id));
  return { added, removed, visibilityChanged, unchanged };
}
