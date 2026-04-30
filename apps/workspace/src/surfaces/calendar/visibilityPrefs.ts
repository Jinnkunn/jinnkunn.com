// Persisted view-prefs for the calendar surface. Specifically, which
// EventKit calendar IDs the operator wants visible in the workspace
// (the toggles on the SourceSidebar). This is workspace-only state —
// hiding a calendar here does NOT remove it from the public /calendar
// projection. Public projection is controlled by each calendar's
// default visibility rule: Hidden excludes it; Busy / Title / Full
// include it with the matching disclosure level.
//
// Storage layout: a single localStorage key holding both the current
// visibility set AND the union of every calendar id we've ever seen.
// The "known ids" set lets us distinguish two cases on the next load:
//   - "user explicitly toggled this one off"  → leave hidden
//   - "this calendar didn't exist last time"  → default to visible
// Without that, adding a brand-new calendar in Apple Calendar.app
// would be silently invisible until the operator hunted down its
// toggle, which is the opposite of "default all selected, remember
// my choices".

const STORAGE_KEY = "workspace.calendar.visibilityPrefs.v1";

interface PersistedVisibilityPrefs {
  /** IDs the user wants visible in the workspace right now. */
  visible: string[];
  /** Every calendar id we've ever materialized — used to detect
   * "newly-appeared" calendars on the next load. Grows monotonically
   * (a calendar deleted on the OS side stays in the list, which is
   * harmless: the next loadAll just won't render it). */
  knownIds: string[];
}

function safeRead(): PersistedVisibilityPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedVisibilityPrefs>;
    if (!parsed || typeof parsed !== "object") return null;
    const visible = Array.isArray(parsed.visible)
      ? parsed.visible.filter((id): id is string => typeof id === "string")
      : [];
    const knownIds = Array.isArray(parsed.knownIds)
      ? parsed.knownIds.filter((id): id is string => typeof id === "string")
      : [];
    return { visible, knownIds };
  } catch {
    return null;
  }
}

export interface VisibilityState {
  visible: Set<string>;
  knownIds: Set<string>;
}

/** Load on mount. Returns `null` when there's no persisted entry yet —
 * the caller should treat that as "first launch", which (per the
 * convention here) means default-to-all-selected once calendars
 * actually load. */
export function loadVisibilityPrefs(): VisibilityState | null {
  const raw = safeRead();
  if (!raw) return null;
  return {
    visible: new Set(raw.visible),
    knownIds: new Set(raw.knownIds),
  };
}

/** Persist after every change. Cheap (a single setItem with a small
 * JSON string), so we call it from a useEffect on every set update
 * rather than batching. */
export function saveVisibilityPrefs(state: VisibilityState): void {
  try {
    const payload: PersistedVisibilityPrefs = {
      visible: Array.from(state.visible),
      knownIds: Array.from(state.knownIds),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private-mode failure — degrade silently. Worst case
    // the user's selection doesn't carry across launches; functional
    // behaviour is unchanged.
  }
}

/** Reconcile a freshly-loaded list of EventKit calendars against the
 * persisted state. New calendars (not in `knownIds` from last load)
 * default to visible; previously-known calendars retain whatever
 * visibility the user last chose. Returns the next `(visible,
 * knownIds)` pair the caller should both render and persist.
 *
 * `prev === null` means first launch (no persisted entry) — every
 * loaded calendar starts visible. */
export function reconcileVisibility(
  loadedIds: string[],
  prev: VisibilityState | null,
): VisibilityState {
  if (prev === null) {
    // First-launch path. Mirrors the historical "Select-all the first
    // time" behaviour from CalendarSurface.tsx, just with the result
    // captured in the persisted shape.
    const all = new Set(loadedIds);
    return { visible: new Set(all), knownIds: all };
  }
  const visible = new Set(prev.visible);
  const knownIds = new Set(prev.knownIds);
  for (const id of loadedIds) {
    if (!knownIds.has(id)) {
      visible.add(id);
      knownIds.add(id);
    }
  }
  return { visible, knownIds };
}
