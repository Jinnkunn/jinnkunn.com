export const ACCESS_MODES = ["public", "password", "github"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const PROTECTED_ACCESS_MODES = ["password", "github"] as const;
export type ProtectedAccessMode = (typeof PROTECTED_ACCESS_MODES)[number];

function normalizeAccessInput(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function parseAccessMode(value: unknown): AccessMode | null {
  const raw = normalizeAccessInput(value);
  for (const mode of ACCESS_MODES) {
    if (raw === mode) return mode;
  }
  return null;
}

export function normalizeAccessMode(
  value: unknown,
  fallback: AccessMode = "public",
): AccessMode {
  return parseAccessMode(value) ?? fallback;
}

export function parseProtectedAccessMode(value: unknown): ProtectedAccessMode | null {
  const raw = normalizeAccessInput(value);
  for (const mode of PROTECTED_ACCESS_MODES) {
    if (raw === mode) return mode;
  }
  return null;
}

export function normalizeProtectedAccessMode(
  value: unknown,
  fallback: ProtectedAccessMode = "password",
): ProtectedAccessMode {
  return parseProtectedAccessMode(value) ?? fallback;
}
