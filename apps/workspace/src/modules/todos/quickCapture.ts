export interface QuickTodoDraft {
  dueAt: number | null;
  estimatedMinutes: number | null;
  preview: string;
  scheduledEndAt: number | null;
  scheduledStartAt: number | null;
  title: string;
}

interface ParsedDate {
  date: Date;
  explicit: boolean;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

const MAX_ESTIMATE_MINUTES = 24 * 60;

export function hasQuickTodoPrefix(input: string): boolean {
  return /^\s*(?:\+|todo:?|todos:?|task:?|new todo:?|新任务[:：]?|待办[:：]?)/i.test(input);
}

export function parseQuickTodoInput(
  input: string,
  now = new Date(),
): QuickTodoDraft | null {
  const normalized = stripQuickTodoPrefix(input).trim();
  if (!normalized) return null;

  let working = normalized;
  const estimate = extractEstimate(working);
  working = estimate.text;
  const parsedDate = extractDate(working, now);
  working = parsedDate.text;
  const parsedTime = extractTime(working);
  working = parsedTime.text;

  const title = normalizeTitle(working) || normalizeTitle(normalized);
  if (!title) return null;

  const date = resolveDraftDate(parsedDate.value, parsedTime.value, now);
  const scheduledStartAt =
    date && parsedTime.value
      ? new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          parsedTime.value.hour,
          parsedTime.value.minute,
          0,
          0,
        ).getTime()
      : null;
  const dueAt =
    date && !parsedTime.value
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0).getTime()
      : null;
  const scheduledEndAt =
    scheduledStartAt !== null && estimate.value !== null
      ? scheduledStartAt + estimate.value * 60_000
      : null;

  return {
    dueAt,
    estimatedMinutes: estimate.value,
    preview: formatQuickTodoPreview({
      dueAt,
      estimatedMinutes: estimate.value,
      scheduledStartAt,
    }),
    scheduledEndAt,
    scheduledStartAt,
    title,
  };
}

function stripQuickTodoPrefix(input: string): string {
  return input.replace(
    /^\s*(?:\+|todo:?|todos:?|task:?|new todo:?|新任务[:：]?|待办[:：]?)\s*/i,
    "",
  );
}

function extractEstimate(input: string): {
  text: string;
  value: number | null;
} {
  let value: number | null = null;
  let text = input;
  const replaceEstimate = (regex: RegExp, multiplier: number) => {
    text = text.replace(regex, (_match, amount: string) => {
      if (value === null) {
        value = normalizeEstimate(Number(amount) * multiplier);
      }
      return " ";
    });
  };

  replaceEstimate(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i, 60);
  replaceEstimate(/(\d+(?:\.\d+)?)\s*(?:小时|小時)/, 60);
  replaceEstimate(/\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/i, 1);
  replaceEstimate(/(\d+(?:\.\d+)?)\s*(?:分钟|分鐘)/, 1);

  return { text, value };
}

function extractDate(
  input: string,
  now: Date,
): {
  text: string;
  value: ParsedDate | null;
} {
  let text = input;
  let value: ParsedDate | null = null;
  const setRelative = (regex: RegExp, days: number) => {
    if (value) return;
    text = text.replace(regex, () => {
      if (!value) value = { date: addDays(startOfDay(now), days), explicit: true };
      return " ";
    });
  };

  setRelative(/\b(today)\b/i, 0);
  setRelative(/今天|今日/, 0);
  setRelative(/\b(tomorrow)\b/i, 1);
  setRelative(/明天/, 1);
  setRelative(/后天|後天/, 2);

  if (!value) {
    text = text.replace(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/, (
      _match,
      year: string,
      month: string,
      day: string,
    ) => {
      if (!value) {
        value = {
          date: new Date(Number(year), Number(month) - 1, Number(day)),
          explicit: true,
        };
      }
      return " ";
    });
  }

  if (!value) {
    text = text.replace(/\b(\d{1,2})[/-](\d{1,2})\b/, (
      _match,
      month: string,
      day: string,
    ) => {
      if (!value) {
        const date = new Date(now.getFullYear(), Number(month) - 1, Number(day));
        if (date < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
        value = { date, explicit: true };
      }
      return " ";
    });
  }

  if (!value) {
    text = text.replace(
      /\b(next\s+)?(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
      (_match, next: string | undefined, weekday: string) => {
        if (!value) {
          value = {
            date: nextWeekday(now, weekdayToIndex(weekday), Boolean(next)),
            explicit: true,
          };
        }
        return " ";
      },
    );
  }

  if (!value) {
    text = text.replace(/(?:周|星期|礼拜)([一二三四五六日天])/, (
      _match,
      weekday: string,
    ) => {
      if (!value) {
        value = {
          date: nextWeekday(now, chineseWeekdayToIndex(weekday), false),
          explicit: true,
        };
      }
      return " ";
    });
  }

  return { text, value };
}

function extractTime(input: string): {
  text: string;
  value: ParsedTime | null;
} {
  let text = input;
  let value: ParsedTime | null = null;

  const setTime = (hour: number, minute: number) => {
    const normalizedHour = ((hour % 24) + 24) % 24;
    value = { hour: normalizedHour, minute: Math.min(Math.max(minute, 0), 59) };
  };

  text = text.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (
    _match,
    rawHour: string,
    rawMinute: string | undefined,
    meridiem: string,
  ) => {
    if (!value) {
      let hour = Number(rawHour);
      const minute = rawMinute ? Number(rawMinute) : 0;
      const lower = meridiem.toLowerCase();
      if (lower === "pm" && hour < 12) hour += 12;
      if (lower === "am" && hour === 12) hour = 0;
      setTime(hour, minute);
    }
    return " ";
  });

  if (!value) {
    text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/, (
      _match,
      rawHour: string,
      rawMinute: string,
    ) => {
      if (!value) setTime(Number(rawHour), Number(rawMinute));
      return " ";
    });
  }

  if (!value) {
    text = text.replace(/(上午|早上|下午|晚上|中午)?\s*(\d{1,2})\s*[点點](半|(?:(\d{1,2})分?)?)?/, (
      _match,
      period: string | undefined,
      rawHour: string,
      halfOrMinute: string | undefined,
      rawMinute: string | undefined,
    ) => {
      if (!value) {
        let hour = Number(rawHour);
        const minute = halfOrMinute === "半" ? 30 : rawMinute ? Number(rawMinute) : 0;
        if ((period === "下午" || period === "晚上") && hour < 12) hour += 12;
        if ((period === "上午" || period === "早上") && hour === 12) hour = 0;
        setTime(hour, minute);
      }
      return " ";
    });
  }

  return { text, value };
}

function resolveDraftDate(
  parsedDate: ParsedDate | null,
  parsedTime: ParsedTime | null,
  now: Date,
): Date | null {
  if (parsedDate) return parsedDate.date;
  if (!parsedTime) return null;
  const today = startOfDay(now);
  const candidate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    parsedTime.hour,
    parsedTime.minute,
  );
  return candidate.getTime() <= now.getTime() ? addDays(today, 1) : today;
}

function formatQuickTodoPreview({
  dueAt,
  estimatedMinutes,
  scheduledStartAt,
}: {
  dueAt: number | null;
  estimatedMinutes: number | null;
  scheduledStartAt: number | null;
}): string {
  const parts: string[] = [];
  if (scheduledStartAt !== null) {
    parts.push(`scheduled ${formatDateTime(scheduledStartAt)}`);
  } else if (dueAt !== null) {
    parts.push(`due ${formatDate(dueAt)}`);
  } else {
    parts.push("inbox");
  }
  if (estimatedMinutes !== null) parts.push(`${estimatedMinutes}m`);
  return parts.join(" / ");
}

function normalizeEstimate(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(Math.round(value), MAX_ESTIMATE_MINUTES);
}

function normalizeTitle(input: string): string {
  return input
    .replace(/[，,；;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function nextWeekday(now: Date, targetDay: number, forceNext: boolean): Date {
  const base = startOfDay(now);
  let offset = targetDay - base.getDay();
  if (offset < 0 || (forceNext && offset === 0)) offset += 7;
  return addDays(base, offset);
}

function weekdayToIndex(value: string): number {
  const key = value.slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(key);
}

function chineseWeekdayToIndex(value: string): number {
  if (value === "日" || value === "天") return 0;
  return "一二三四五六".indexOf(value) + 1;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDate(timestamp)} ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
