export type CalendarProductionSyncPolicy = "manual" | "auto-promote";

const LEGACY_STORAGE_KEY = "workspace.calendar.productionSyncPolicy.v1";
const STORAGE_KEY = "workspace.calendar.productionSyncPolicy.v2";
const DEFAULT_POLICY: CalendarProductionSyncPolicy = "auto-promote";

export const CALENDAR_PRODUCTION_SYNC_OPTIONS: ReadonlyArray<{
  value: CalendarProductionSyncPolicy;
  label: string;
  hint: string;
}> = [
  {
    value: "auto-promote",
    label: "Auto",
    hint: "When the desktop app is running, sync staging and dispatch production after real calendar changes.",
  },
  {
    value: "manual",
    label: "Manual",
    hint: "Sync staging automatically; promote production from Release Center.",
  },
];

export function normalizeCalendarProductionSyncPolicy(
  raw: unknown,
): CalendarProductionSyncPolicy {
  if (raw === "manual") return "manual";
  if (raw === "auto-promote") return "auto-promote";
  return DEFAULT_POLICY;
}

export function loadCalendarProductionSyncPolicy(): CalendarProductionSyncPolicy {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) return normalizeCalendarProductionSyncPolicy(current);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null) return DEFAULT_POLICY;
    // Migrate the legacy v1 entry to the current key so future loads
    // skip the legacy lookup and the v1 entry can eventually be
    // removed without breaking long-running clients. Drop the old key
    // immediately — leaving it around lets a future v3 migration see
    // two stale generations to reason about, which is the kind of
    // thing that turns a one-line load into a three-step archaeology
    // dig later.
    const migrated: CalendarProductionSyncPolicy =
      legacy === "auto-promote" ? "auto-promote" : DEFAULT_POLICY;
    localStorage.setItem(STORAGE_KEY, migrated);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return migrated;
  } catch {
    return DEFAULT_POLICY;
  }
}

export function saveCalendarProductionSyncPolicy(
  policy: CalendarProductionSyncPolicy,
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      normalizeCalendarProductionSyncPolicy(policy),
    );
  } catch {
    // Local preference only. Fallback stays auto-promote for the light
    // background-sync workflow.
  }
}
