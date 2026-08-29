import type { ParseResult } from "./parse-result.ts";

const COLLECTOR_ID_MAX_LENGTH = 160;
const COLLECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const CLEANUP_FIELDS = new Set(["collectorId", "range"]);
const RANGE_FIELDS = new Set(["startsAt", "endsAt"]);

export type CalendarCollectorCleanupRange = {
  startsAt: string;
  endsAt: string;
};

export type CalendarCollectorCleanupCommand = {
  collectorId: string;
  range?: CalendarCollectorCleanupRange;
};

function invalid(error: string): ParseResult<never> {
  return { ok: false, error, status: 400 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedIso(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !ISO_TIMESTAMP_PATTERN.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseCalendarCollectorCleanupCommand(
  raw: Record<string, unknown>,
): ParseResult<CalendarCollectorCleanupCommand> {
  const unsupportedField = Object.keys(raw).find((key) => !CLEANUP_FIELDS.has(key));
  if (unsupportedField) {
    return invalid(`Unsupported cleanup field: ${unsupportedField}`);
  }

  const collectorId = typeof raw.collectorId === "string" ? raw.collectorId.trim() : "";
  if (!collectorId) return invalid("collectorId is required");
  if (
    collectorId.length > COLLECTOR_ID_MAX_LENGTH ||
    !COLLECTOR_ID_PATTERN.test(collectorId)
  ) {
    return invalid("collectorId is invalid");
  }

  if (raw.range === undefined) return { ok: true, value: { collectorId } };
  if (!isRecord(raw.range)) return invalid("range must be an object");
  const unsupportedRangeField = Object.keys(raw.range).find(
    (key) => !RANGE_FIELDS.has(key),
  );
  if (unsupportedRangeField) {
    return invalid(`Unsupported range field: ${unsupportedRangeField}`);
  }

  const startsAt = normalizedIso(raw.range.startsAt);
  const endsAt = normalizedIso(raw.range.endsAt);
  if (!startsAt || !endsAt) {
    return invalid("range.startsAt and range.endsAt must be valid ISO timestamps");
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    return invalid("range.endsAt must be after range.startsAt");
  }

  return {
    ok: true,
    value: { collectorId, range: { startsAt, endsAt } },
  };
}
