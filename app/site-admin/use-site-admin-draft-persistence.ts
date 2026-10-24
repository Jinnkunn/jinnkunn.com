import { useEffect, useRef, useState } from "react";
import { writeLocalDraft, type LocalDraftSnapshot } from "./site-admin-draft-storage";

export function useSiteAdminDraftPersistence<Form>({
  kind, id, dirty, snapshot, autosaveEnabled, onSave, onRecoverySaved, onRecoveryFailure,
}: {
  kind: string; id: string; dirty: boolean;
  snapshot: Omit<LocalDraftSnapshot<Form>, "key" | "savedAt">;
  autosaveEnabled: boolean;
  onSave: () => void | Promise<boolean | void>;
  onRecoverySaved: (savedAt: string) => void;
  onRecoveryFailure: () => void;
}) {
  const failedSource = useRef("");
  const [retry, setRetry] = useState(0);
  const fingerprint = `${kind}:${id}:${JSON.stringify(snapshot)}`;
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
    if (!id || !dirty) return;
    const flush = () => {
      const savedAt = new Date().toISOString();
      if (!writeLocalDraft(kind, id, { ...snapshot, savedAt })) callbacks.current.onRecoveryFailure();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); };
  }, [kind, id, dirty, snapshot]);

  useEffect(() => {
    const online = () => { failedSource.current = ""; setRetry((value) => value + 1); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  useEffect(() => {
    if (!id || !dirty || !autosaveEnabled || failedSource.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => callbacks.current.onSave()).then((saved) => {
        failedSource.current = saved === false ? fingerprint : "";
      }).catch(() => { failedSource.current = fingerprint; });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [kind, id, dirty, snapshot, autosaveEnabled, fingerprint, retry]);
}
