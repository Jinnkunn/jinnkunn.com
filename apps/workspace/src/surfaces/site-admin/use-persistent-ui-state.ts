import { useEffect, useState } from "react";

export function usePersistentUiState<TValue>(
  key: string,
  initialValue: TValue,
  validate: (value: unknown) => value is TValue,
) {
  const [value, setValue] = useState<TValue>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initialValue;
      const parsed = JSON.parse(raw) as unknown;
      return validate(parsed) ? parsed : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore private-mode/quota failures; persistence is a convenience.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
