import { useCallback, useEffect, useRef, useState } from "react";

/** Envelope we persist under each draft key. `savedAt` is a client epoch-
 * ms timestamp; we don't try to compare it against server-side mtime
 * because the `/posts/:slug` response doesn't currently expose one — we
 * just show the banner whenever a draft exists and let the user decide. */
export interface DraftEnvelope<TForm> {
  body: string;
  form: TForm;
  slug: string;
  savedAt: number;
  version: 1;
}

export type EditorKind = "post" | "page" | "component";

const DRAFT_PREFIX = "workspace.site-admin.drafts";

function draftKey(kind: EditorKind, slug: string): string {
  return `${DRAFT_PREFIX}.${kind}.${slug || "__new__"}.v1`;
}

const AUTOSAVE_DEBOUNCE_MS = 500;

export interface UseEditorDraftResult<TForm> {
  /** If a draft exists for this slug (from a previous session or tab), the
   * parsed envelope. The caller renders a restore banner and decides how
   * to handle it. */
  restorable: DraftEnvelope<TForm> | null;
  /** Remove the draft from localStorage — call after a successful server
   * save/delete, and when the user picks "Discard". */
  clearDraft: () => void;
  /** Dismiss the restore banner without clearing the draft. Useful when
   * the caller has already applied the draft to its own state. */
  dismissRestore: () => void;
}

/** Debounced autosave of the editor's body + frontmatter form into
 * localStorage, with a "restore previous draft" affordance on next mount.
 *
 * Scope: intentionally simple. One draft per (kind, slug) pair; new-post
 * drafts collide under a single `__new__` key so creating two at once
 * loses one of them. Good enough for the common case ("I was in the
 * middle of writing this post and the app quit").
 *
 * `dirty` gates writes — without it the load-induced state change
 * triggers the autosave effect (body/form transition from initial
 * empty values to the fetched ones) and writes the loaded content as
 * a "draft", causing a false-positive "Unsaved draft" banner on the
 * next open. We only persist when there's a real diff vs. the last
 * server snapshot. */
export function useEditorDraft<TForm>(
  kind: EditorKind,
  slug: string,
  body: string,
  form: TForm,
  enabled: boolean,
  dirty: boolean,
): UseEditorDraftResult<TForm> {
  const [restorable, setRestorable] =
    useState<DraftEnvelope<TForm> | null>(null);

  // Read any existing draft on mount + when slug changes. Computes the
  // next state first and calls `setRestorable` exactly once at the end so
  // there's only one state-write in the effect body — cleaner to read and
  // narrower surface for the lint disable.
  useEffect(() => {
    let next: DraftEnvelope<TForm> | null = null;
    if (enabled) {
      try {
        const raw = localStorage.getItem(draftKey(kind, slug));
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<DraftEnvelope<TForm>>;
          if (
            parsed &&
            typeof parsed.body === "string" &&
            parsed.form !== undefined &&
            typeof parsed.savedAt === "number" &&
            parsed.version === 1
          ) {
            next = {
              body: parsed.body,
              form: parsed.form as TForm,
              slug: typeof parsed.slug === "string" ? parsed.slug : slug,
              savedAt: parsed.savedAt,
              version: 1,
            };
          }
        }
      } catch {
        // Corrupt JSON / storage access error — treat as no draft.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestorable(next);
  }, [enabled, kind, slug]);

  // Autosave on change, debounced. Skip when disabled (loading state)
  // OR when not dirty (`body`/`form` still match the last server
  // snapshot). The dirty gate is what stops the load-induced state
  // change from being persisted as a "draft" identical to the saved
  // content — without it, every page open quietly creates a fake
  // draft that surfaces as "Unsaved draft" on the next visit.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !dirty) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      try {
        const envelope: DraftEnvelope<TForm> = {
          body,
          form,
          slug,
          savedAt: Date.now(),
          version: 1,
        };
        localStorage.setItem(draftKey(kind, slug), JSON.stringify(envelope));
      } catch {
        // Quota exceeded / private mode / serialization error — drop.
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, dirty, kind, slug, body, form]);

  // Auto-discard stale drafts: when there's no active edit (`!dirty`)
  // and the persisted draft body+form already match the current
  // server snapshot, drop the localStorage entry so the banner stops
  // showing for content that's already saved. Cheap JSON.stringify
  // for `form` equality — the form is small (title / draft / a few
  // strings) and only this hook's lifetime depends on it.
  useEffect(() => {
    if (!enabled) return;
    if (!restorable) return;
    if (dirty) return;
    const sameBody = restorable.body === body;
    const sameForm =
      JSON.stringify(restorable.form) === JSON.stringify(form);
    if (!sameBody || !sameForm) return;
    try {
      localStorage.removeItem(draftKey(kind, slug));
    } catch {
      // ignore — best-effort cleanup
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestorable(null);
  }, [enabled, dirty, restorable, body, form, kind, slug]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey(kind, slug));
    } catch {
      // ignore
    }
    setRestorable(null);
  }, [kind, slug]);

  const dismissRestore = useCallback(() => setRestorable(null), []);

  return { restorable, clearDraft, dismissRestore };
}

/** Format a draft's `savedAt` as a short relative label ("just now",
 * "2m ago", "1h ago"). Used in the restore banner. */
export function formatDraftAge(savedAt: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - savedAt);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
