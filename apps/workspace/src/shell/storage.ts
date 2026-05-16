export type BooleanMap = Record<string, boolean>;

export function readBooleanFromStorage(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeBooleanToStorage(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // State stays in-memory when storage is unavailable.
  }
}

export function readStringListFromStorage(key: string): readonly string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

export function writeJsonToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // State stays in-memory when storage is unavailable.
  }
}

export function readBooleanMapFromStorage(key: string): BooleanMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: BooleanMap = {};
    for (const itemKey of Object.keys(parsed)) {
      if (typeof parsed[itemKey] === "boolean") {
        out[itemKey] = parsed[itemKey] as boolean;
      }
    }
    return out;
  } catch {
    return {};
  }
}
