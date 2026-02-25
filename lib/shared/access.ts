export const ACCESS_MODES = ["public", "password", "github"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const PROTECTED_ACCESS_MODES = ["password", "github"] as const;
export type ProtectedAccessMode = (typeof PROTECTED_ACCESS_MODES)[number];

export function normalizeAccessMode(
  value: unknown,
  fallback: AccessMode = "public",
): AccessMode {
  const raw = String(value || "").trim().toLowerCase();
  for (const mode of ACCESS_MODES) {
    if (raw === mode) return mode;
  }
  return fallback;
}

export function normalizeProtectedAccessMode(
  value: unknown,
  fallback: ProtectedAccessMode = "password",
): ProtectedAccessMode {
  const raw = String(value || "").trim().toLowerCase();
  for (const mode of PROTECTED_ACCESS_MODES) {
    if (raw === mode) return mode;
  }
  return fallback;
}

