// Date-only announcement and appearance settings use the site's Halifax day.
const halifax = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function presentationTimestamp(value: string, endOfDay = false): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw);
  if (!dateOnly && !localDateTime) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const wallTime = Date.parse(dateOnly ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z` : `${raw}Z`);
  if (!Number.isFinite(wallTime)) return null;
  // Resolve the offset on the actual local day (including winter/DST).
  let utc = wallTime;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(halifax.formatToParts(utc).map(({ type, value }) => [type, value]));
    const displayed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, ((utc % 1000) + 1000) % 1000);
    const adjustment = wallTime - displayed;
    if (!adjustment) return utc;
    utc += adjustment;
  }
  return utc;
}

export function nextPresentationBoundary(windows: { startsAt: string; endsAt: string }[], now: number) {
  let next = Infinity;
  for (const { startsAt, endsAt } of windows) {
    const start = presentationTimestamp(startsAt);
    const end = presentationTimestamp(endsAt, true);
    if (start !== null && start > now) next = Math.min(next, start);
    if (end !== null && end >= now) next = Math.min(next, end + 1);
  }
  return Number.isFinite(next) ? next : null;
}
