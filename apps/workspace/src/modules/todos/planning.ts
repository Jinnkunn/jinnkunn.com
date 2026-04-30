export type TodoSchedulePreset =
  | "nextWeek"
  | "thisWeek"
  | "today"
  | "tomorrow";

export const TODO_SCHEDULE_PRESETS: TodoSchedulePreset[] = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
];

export function todoSchedulePresetLabel(preset: TodoSchedulePreset): string {
  switch (preset) {
    case "nextWeek":
      return "Next Week";
    case "thisWeek":
      return "This Week";
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
  }
}

export function startOfLocalDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addLocalDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

export function dateInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

export function dateTimeInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function dateTimeInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function timeInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function dateAndTimeInputToTimestamp(
  dateValue: string,
  timeValue: string,
): number | null {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map((part) => Number(part));
  const [hour, minute] = timeValue.split(":").map((part) => Number(part));
  if (
    !year ||
    !month ||
    !day ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

export function estimateInputToMinutes(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.round(parsed), 24 * 60);
}

export function scheduleEndTimestamp(
  scheduledStartAt: number | null,
  estimatedMinutes: number | null,
): number | null {
  if (scheduledStartAt === null || estimatedMinutes === null) return null;
  return scheduledStartAt + estimatedMinutes * 60_000;
}

export function presetDueTimestamp(
  preset: TodoSchedulePreset,
  now = new Date(),
): number {
  const today = startOfLocalDay(now);
  const due = new Date(today);
  switch (preset) {
    case "today":
      break;
    case "tomorrow":
      due.setDate(today.getDate() + 1);
      break;
    case "thisWeek": {
      const daysUntilSunday = (7 - today.getDay()) % 7;
      due.setDate(today.getDate() + daysUntilSunday);
      break;
    }
    case "nextWeek": {
      const daysUntilSunday = (7 - today.getDay()) % 7;
      due.setDate(today.getDate() + daysUntilSunday + 7);
      break;
    }
  }
  due.setHours(12, 0, 0, 0);
  return due.getTime();
}

export function todoPresetUpdateParams(
  preset: TodoSchedulePreset,
  now = new Date(),
): {
  dueAt: number;
  scheduledEndAt: null;
  scheduledStartAt: null;
} {
  return {
    dueAt: presetDueTimestamp(preset, now),
    scheduledEndAt: null,
    scheduledStartAt: null,
  };
}

export function todoScheduleAtUpdateParams(
  scheduledStartAt: number,
  estimatedMinutes: number | null,
): {
  estimatedMinutes: number | null;
  scheduledEndAt: number | null;
  scheduledStartAt: number;
} {
  return {
    estimatedMinutes,
    scheduledEndAt: scheduleEndTimestamp(scheduledStartAt, estimatedMinutes),
    scheduledStartAt,
  };
}

export function clearTodoPlanningUpdateParams(): {
  dueAt: null;
  estimatedMinutes: null;
  scheduledEndAt: null;
  scheduledStartAt: null;
} {
  return {
    dueAt: null,
    estimatedMinutes: null,
    scheduledEndAt: null,
    scheduledStartAt: null,
  };
}
