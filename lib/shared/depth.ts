const DEFAULT_MIN_DEPTH = 0;
const DEFAULT_MAX_DEPTH = 20;

type DepthBounds = {
  min?: number;
  max?: number;
};

function resolveDepthBounds(bounds?: DepthBounds): { min: number; max: number } {
  const minRaw = bounds?.min;
  const maxRaw = bounds?.max;
  const min = Number.isFinite(minRaw) ? Math.floor(Number(minRaw)) : DEFAULT_MIN_DEPTH;
  const max = Number.isFinite(maxRaw) ? Math.floor(Number(maxRaw)) : DEFAULT_MAX_DEPTH;
  if (max < min) return { min, max: min };
  return { min, max };
}

function toNumberOrNaN(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return Number.NaN;
    return Number(raw);
  }
  if (value === null || value === undefined) return Number.NaN;
  return Number(value);
}

export function parseDepthNumber(value: unknown, bounds?: DepthBounds): number | null {
  const n = toNumberOrNaN(value);
  if (!Number.isFinite(n)) return null;
  const { min, max } = resolveDepthBounds(bounds);
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function normalizeDepthString(value: unknown, bounds?: DepthBounds): string {
  const n = parseDepthNumber(value, bounds);
  return n === null ? "" : String(n);
}
