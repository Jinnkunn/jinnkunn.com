import { useEffect, useMemo, useRef, useState } from "react";
import { clearLocalDraft, readLocalDraft, requiresRecoveryReview, type LocalDraftSnapshot } from "./site-admin-draft-storage";
import { useSiteAdminDraftPersistence } from "./use-site-admin-draft-persistence";

export function useSiteAdminSingletonDraft<Form>({ kind, id, ready, dirty, source, form, baseVersion, enabled, onSave, onRestore }: {
  kind: string; id: string; ready: boolean; dirty: boolean; source: string; form: Form; baseVersion: string;
  enabled: boolean; onSave: () => Promise<boolean>; onRestore: (form: Form) => void;
}) {
  const [recovery, setRecovery] = useState<LocalDraftSnapshot<Form> | null>(null);
  const [localSavedAt, setLocalSavedAt] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [failed, setFailed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const saving = useRef(false);
  const latest = useRef({ source, onSave, onRestore });
  latest.current = { source, onSave, onRestore };
  useEffect(() => {
    if (!ready) return;
    const copy = readLocalDraft<Form>(kind, id);
    setRecovery(copy?.source !== latest.current.source && copy?.form ? copy : null);
    setLocalSavedAt(""); setSavedAt(""); setFailed(false); setNeedsReview(false);
  }, [kind, id, ready]);
  useEffect(() => {
    const online = () => setFailed(false);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  const snapshot = useMemo(() => ({ source, form, baseVersion }), [source, form, baseVersion]);
  async function save() {
    if (saving.current || !enabled) return false;
    saving.current = true;
    const captured = latest.current.source;
    setFailed(false);
    try {
      const ok = await latest.current.onSave();
      if (!ok) { setFailed(true); return false; }
      setSavedAt(new Date().toISOString()); setNeedsReview(false);
      if (latest.current.source === captured) {
        clearLocalDraft(kind, id); setLocalSavedAt(""); setRecovery(null);
      }
      return true;
    } catch { setFailed(true); return false; }
    finally { saving.current = false; }
  }
  useSiteAdminDraftPersistence({
    kind, id: ready && !recovery ? id : "", dirty, snapshot,
    autosaveEnabled: enabled && !failed && !needsReview,
    onSave: save,
    onRecoverySaved: (at) => { setLocalSavedAt(at); setStorageFailed(false); },
    onRecoveryFailure: () => setStorageFailed(true),
  });
  function restore() {
    if (!recovery?.form) return;
    const older = requiresRecoveryReview(recovery, baseVersion);
    if (older && !window.confirm("A newer server draft exists. Restore the local copy into the editor for review? It will not autosave until you explicitly save it.")) return;
    latest.current.onRestore(recovery.form);
    setNeedsReview(older); setFailed(false); setLocalSavedAt(recovery.savedAt); setRecovery(null);
  }
  function dismiss() { clearLocalDraft(kind, id); setRecovery(null); }
  function resume() { setFailed(false); setNeedsReview(false); }
  return { recovery, localSavedAt, savedAt, failed, needsReview, storageFailed, save, restore, dismiss, resume };
}
