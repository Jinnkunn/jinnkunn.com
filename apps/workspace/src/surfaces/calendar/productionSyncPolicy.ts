export type CalendarProductionSyncPolicy = "manual" | "auto-promote";

const STORAGE_KEY = "workspace.calendar.productionSyncPolicy.v1";

export const CALENDAR_PRODUCTION_SYNC_OPTIONS: ReadonlyArray<{
  value: CalendarProductionSyncPolicy;
  label: string;
  hint: string;
}> = [
  {
    value: "manual",
    label: "Manual",
    hint: "Sync staging automatically; promote production from Release Center.",
  },
  {
    value: "auto-promote",
    label: "Auto",
    hint: "After a real staging calendar sync, dispatch the guarded production release.",
  },
];

export function normalizeCalendarProductionSyncPolicy(
  raw: unknown,
): CalendarProductionSyncPolicy {
  return raw === "auto-promote" ? "auto-promote" : "manual";
}

export function loadCalendarProductionSyncPolicy(): CalendarProductionSyncPolicy {
  try {
    return normalizeCalendarProductionSyncPolicy(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "manual";
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
    // Local preference only. Fallback stays manual.
  }
}
