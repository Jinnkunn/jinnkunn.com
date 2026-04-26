import { useCallback, useEffect, useRef, useState } from "react";

export interface JsonDraftEnvelope<TValue> {
  value: TValue;
  savedAt: number;
  version: 1;
}

const PREFIX = "workspace.site-admin.json-drafts";
const AUTOSAVE_DEBOUNCE_MS = 600;

function storageKey(key: string): string {
  return `${PREFIX}.${key}.v1`;
}

export function useJsonDraft<TValue>(
  key: string,
  value: TValue,
  autosave: boolean,
) {
  const [restorable, setRestorable] =
    useState<JsonDraftEnvelope<TValue> | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let next: JsonDraftEnvelope<TValue> | null = null;
    try {
      const raw = localStorage.getItem(storageKey(key));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<JsonDraftEnvelope<TValue>>;
        if (
          parsed &&
          parsed.value !== undefined &&
          typeof parsed.savedAt === "number" &&
          parsed.version === 1
        ) {
          next = {
            value: parsed.value as TValue,
            savedAt: parsed.savedAt,
            version: 1,
          };
        }
      }
    } catch {
      // Corrupt or unavailable localStorage: treat as no draft.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestorable(next);
  }, [key]);

  useEffect(() => {
    if (!autosave) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try {
        const envelope: JsonDraftEnvelope<TValue> = {
          value,
          savedAt: Date.now(),
          version: 1,
        };
        localStorage.setItem(storageKey(key), JSON.stringify(envelope));
      } catch {
        // Ignore quota/private-mode errors.
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autosave, key, value]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      // ignore
    }
    setRestorable(null);
  }, [key]);

  const dismissRestore = useCallback(() => setRestorable(null), []);

  return { restorable, clearDraft, dismissRestore };
}
