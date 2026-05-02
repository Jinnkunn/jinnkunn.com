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
    if (legacy === "auto-promote") return "auto-promote";
    return DEFAULT_POLICY;
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
