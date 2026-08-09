const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_INDEX: ReadonlyMap<string, number> = new Map(
  [
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ] as const,
);

export type MonthRangeValue = {
  start: string;
  end: string;
  ongoing: boolean;
  valid: boolean;
};

function parseMonthLabel(value: string): string {
  const match = value.trim().match(/^([a-z]+)\s+(\d{4})$/i);
  if (!match) return "";
  const month = MONTH_INDEX.get(match[1].toLocaleLowerCase());
  if (!month) return "";
  return `${match[2]}-${String(month).padStart(2, "0")}`;
}

function formatMonthValue(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS.length) return "";
  return `${MONTHS[monthIndex]} ${match[1]}`;
}

export function parseMonthRangePeriod(value: string): MonthRangeValue {
  const normalized = String(value || "").trim();
  if (!normalized) return { start: "", end: "", ongoing: false, valid: true };

  const parts = normalized.split(/\s+[-–—]\s+/);
  if (parts.length > 2) {
    return { start: "", end: "", ongoing: false, valid: false };
  }

  const start = parseMonthLabel(parts[0] || "");
  if (!start) return { start: "", end: "", ongoing: false, valid: false };
  if (parts.length === 1) return { start, end: "", ongoing: false, valid: true };

  const endLabel = (parts[1] || "").trim();
  if (/^(now|present|current)$/i.test(endLabel)) {
    return { start, end: "", ongoing: true, valid: true };
  }

  const end = parseMonthLabel(endLabel);
  return { start, end, ongoing: false, valid: Boolean(end) };
}

export function formatMonthRangePeriod({
  start,
  end,
  ongoing,
}: Pick<MonthRangeValue, "start" | "end" | "ongoing">): string {
  const startLabel = formatMonthValue(start);
  if (!startLabel) return "";
  if (ongoing) return `${startLabel} – Now`;
  const endLabel = formatMonthValue(end);
  return endLabel ? `${startLabel} – ${endLabel}` : startLabel;
}
