import {
  isLocalCalendarId,
  isLocalCalendarSource,
} from "../../modules/calendar/localCalendarApi";
import type { Calendar, CalendarSource, CalendarSourceType } from "./types";

export type SourceVisibilityState = "empty" | "hidden" | "mixed" | "visible";

export interface SourceVisibilitySummary {
  state: SourceVisibilityState;
  totalCount: number;
  visibleCount: number;
  countLabel: string;
  toggleLabel: string;
}

export interface CalendarCapability {
  canArchive: boolean;
  canEditAppearance: boolean;
  canManageInSystemSettings: boolean;
  label: string;
  tone: "local" | "writable" | "readonly";
}

const SOURCE_TYPE_LABELS: Record<CalendarSourceType, string> = {
  birthdays: "Birthdays",
  calDAV: "CalDAV",
  exchange: "Exchange",
  local: "Local",
  mobileMe: "iCloud",
  subscribed: "Subscribed",
};

export function sourceTypeLabel(type: CalendarSourceType): string {
  return SOURCE_TYPE_LABELS[type] ?? type;
}

export function summarizeSourceVisibility(
  calendars: readonly Calendar[],
  visible: ReadonlySet<string>,
): SourceVisibilitySummary {
  const totalCount = calendars.length;
  const visibleCount = calendars.filter((calendar) => visible.has(calendar.id)).length;
  const state: SourceVisibilityState =
    totalCount === 0
      ? "empty"
      : visibleCount === 0
        ? "hidden"
        : visibleCount === totalCount
          ? "visible"
          : "mixed";
  return {
    state,
    totalCount,
    visibleCount,
    countLabel: totalCount === 0 ? "0" : `${visibleCount}/${totalCount}`,
    toggleLabel: state === "visible" ? "Hide all" : "Show all",
  };
}

export function calendarCapability(calendar: Calendar): CalendarCapability {
  const local = isLocalCalendarId(calendar.id);
  if (local) {
    return {
      canArchive: true,
      canEditAppearance: true,
      canManageInSystemSettings: false,
      label: "Workspace",
      tone: "local",
    };
  }
  if (calendar.allowsModifications) {
    return {
      canArchive: false,
      canEditAppearance: false,
      canManageInSystemSettings: true,
      label: "Writable",
      tone: "writable",
    };
  }
  return {
    canArchive: false,
    canEditAppearance: false,
    canManageInSystemSettings: true,
    label: "Read only",
    tone: "readonly",
  };
}

export function sourceCanOpenSystemSettings(source: CalendarSource): boolean {
  return !isLocalCalendarSource(source.id);
}

export function sourceManagementLabel(source: CalendarSource): string {
  if (isLocalCalendarSource(source.id)) return "Workspace";
  return "macOS";
}

export function calendarSettingsSearchText(
  calendar: Calendar,
  source: CalendarSource | undefined,
): string {
  return [
    calendar.title,
    source?.title ?? "",
    source ? sourceTypeLabel(source.sourceType) : "",
    calendarCapability(calendar).label,
  ]
    .join(" ")
    .toLowerCase();
}
