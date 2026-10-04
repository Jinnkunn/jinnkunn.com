import type { CollectionDraft } from "./site-admin-collection-draft.ts";

export type LocalDraftSnapshot<Form = unknown> = {
  key: string;
  source: string;
  form?: Form;
  collection?: CollectionDraft;
  savedAt: string;
};
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function localDraftKey(kind: string, id: string) {
  return `site-admin-content-draft:${kind}:${id}`;
}

function browserStorage(): DraftStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readLocalDraft<Form>(kind: string, id: string, storage = browserStorage()): LocalDraftSnapshot<Form> | null {
  const key = localDraftKey(kind, id);
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftSnapshot<Form>>;
    if (typeof parsed.source !== "string" || typeof parsed.savedAt !== "string") return null;
    const at = Date.parse(parsed.savedAt);
    if (!Number.isFinite(at) || Date.now() - at > TTL_MS) {
      storage?.removeItem(key);
      return null;
    }
    return { ...parsed, key, source: parsed.source, savedAt: parsed.savedAt };
  } catch { return null; }
}

export function writeLocalDraft<Form>(kind: string, id: string,
  snapshot: Omit<LocalDraftSnapshot<Form>, "key">, storage = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(localDraftKey(kind, id), JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

export function clearLocalDraft(kind: string, id: string, storage = browserStorage()) {
  // Browser storage failure must not turn a successful server save into a failure.
  try { storage?.removeItem(localDraftKey(kind, id)); } catch { /* Recovery is best effort. */ }
}
