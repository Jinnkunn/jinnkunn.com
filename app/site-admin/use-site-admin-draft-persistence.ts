import { useEffect, useRef } from "react";
import { writeLocalDraft, type LocalDraftSnapshot } from "./site-admin-draft-storage";

export function useSiteAdminDraftPersistence<Form>({
  kind, id, dirty, snapshot, autosaveEnabled, onSave, onRecoverySaved, onRecoveryFailure,
}: {
  kind: string; id: string; dirty: boolean;
  snapshot: Omit<LocalDraftSnapshot<Form>, "key" | "savedAt">;
  autosaveEnabled: boolean;
  onSave: () => void;
  onRecoverySaved: (savedAt: string) => void;
  onRecoveryFailure: () => void;
}) {
  const callbacks = useRef({ onSave, onRecoverySaved, onRecoveryFailure });
  useEffect(() => {
    callbacks.current = { onSave, onRecoverySaved, onRecoveryFailure };
  });
  useEffect(() => {
    if (!id || !dirty) return;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      if (writeLocalDraft(kind, id, { ...snapshot, savedAt })) callbacks.current.onRecoverySaved(savedAt);
      else callbacks.current.onRecoveryFailure();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [kind, id, dirty, snapshot]);

  useEffect(() => {
    if (!id || !dirty || !autosaveEnabled) return;
    const timer = window.setTimeout(() => callbacks.current.onSave(), 1600);
    return () => window.clearTimeout(timer);
  }, [kind, id, dirty, snapshot, autosaveEnabled]);
}
