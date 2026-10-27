"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import { SiteAdminPublicationChanges } from "./site-admin-publication-changes";
import { describeVersionRestore } from "./site-admin-version-model";
import styles from "./site-admin-dashboard.module.css";

type VersionEntry = {
  commitSha: string;
  commitShort: string;
  committedAt: string | null;
  authorName: string;
  message: string;
};

type VersionPayload = {
  path: string;
  sourceVersion: { fileSha: string };
  history: VersionEntry[];
  version?: { content: string; sha: string; commitSha: string } | null;
};

function unwrap<T>(raw: unknown): T {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { ok?: unknown }).ok === true &&
    Object.prototype.hasOwnProperty.call(raw, "data")
  ) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

async function versionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((raw as { error?: string } | null)?.error || `Version request failed (${response.status})`);
  }
  return unwrap<T>(raw);
}

function formatVersionTime(value: string | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function SiteAdminVersionHistory({
  path,
  currentSource,
  currentVersion,
  onRestored,
  beforeRestore,
  onRestoringChange,
}: {
  path: string;
  currentSource: string;
  currentVersion: string;
  onRestored: () => Promise<void> | void;
  beforeRestore?: () => Promise<boolean>;
  onRestoringChange?: (saving: boolean) => void;
}) {
  const [history, setHistory] = useState<VersionEntry[]>([]);
  const [historyPath, setHistoryPath] = useState("");
  const [compare, setCompare] = useState<{ entry: VersionEntry; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<{ entry: VersionEntry; content: string; version: string } | null>(null);
  const latest = useRef({ path, currentVersion, onRestored });
  useLayoutEffect(() => { latest.current = { path, currentVersion, onRestored }; });
  const request = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setBusy(false);
    setError("");
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    try {
      const payload = await versionRequest<VersionPayload>(
        `/api/site-admin/versions?path=${encodeURIComponent(path)}&limit=12`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setHistory(payload.history || []);
      setHistoryPath(path);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setCompare(null);
    setRestoreTarget(null);
    void loadHistory();
    return () => { request.current?.abort(); };
  }, [loadHistory, currentVersion]);

  async function compareVersion(entry: VersionEntry, restore = false) {
    if (restore && beforeRestore && !await beforeRestore()) return;
    if (latest.current.path !== path) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    try {
      const payload = await versionRequest<VersionPayload>(
        `/api/site-admin/versions?path=${encodeURIComponent(path)}&commitSha=${encodeURIComponent(entry.commitSha)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!payload.version) throw new Error("Version content is unavailable.");
      setCompare({ entry, content: payload.version.content });
      if (restore) setRestoreTarget({ entry, content: payload.version.content, version: latest.current.currentVersion });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function restoreVersion() {
    if (!restoreTarget || busy) return;
    if (restoreTarget.version !== latest.current.currentVersion) {
      setRestoreTarget(null);
      setError("The draft changed. Compare the version again before restoring.");
      return;
    }
    setBusy(true);
    onRestoringChange?.(true);
    setError("");
    try {
      await versionRequest<VersionPayload>("/api/site-admin/versions", {
        method: "POST",
        body: JSON.stringify({
          path,
          commitSha: restoreTarget.entry.commitSha,
          expectedFileSha: restoreTarget.version,
        }),
      });
      setCompare(null);
      setRestoreTarget(null);
      await latest.current.onRestored();
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onRestoringChange?.(false);
    }
  }

  return (
    <div className={styles.versionHistory}>
      {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}
      {loading ? <p className={styles.editorHint}>Loading history…</p> : null}
      {!loading && history.length === 0 ? (
        <p className={styles.editorHint}>No earlier versions yet.</p>
      ) : null}
      <div className={styles.versionList}>
        {(historyPath === path ? history : []).map((entry) => (
          <div key={`${entry.commitSha}-${entry.committedAt || "unknown"}`} className={styles.versionRow}>
            <div>
              <strong>{formatVersionTime(entry.committedAt)}</strong>
              <small>
                {entry.authorName || "Site Admin"} · {entry.commitShort}
              </small>
            </div>
            <div className={styles.versionActions}>
              <Button
                onClick={() => void compareVersion(entry)}
                variant="subtle"
                size="sm"
                disabled={busy || loading}
              >
                Compare
              </Button>
              <Button
                onClick={() => void compareVersion(entry, true)}
                variant="ghost"
                size="sm"
                disabled={busy || loading}
              >
                Restore
              </Button>
            </div>
          </div>
        ))}
      </div>

      {compare ? (
        <div className={styles.versionCompare}>
          <div className={styles.versionCompareHeader}>
            <strong>Version comparison</strong>
            <Button onClick={() => setCompare(null)} variant="ghost" size="sm">
              Close
            </Button>
          </div>
          <SiteAdminPublicationChanges changes={describeVersionRestore(path, currentSource, compare.content)} beforeLabel="Current editor" afterLabel={`Earlier · ${compare.entry.commitShort}`} />
          {currentSource === compare.content ? <p>No content changes.</p> : null}
        </div>
      ) : null}
      {restoreTarget ? <SiteAdminActionDialog title="Restore earlier draft?" onClose={() => setRestoreTarget(null)} busy={busy}>
        <p>This replaces the saved draft with the version from {formatVersionTime(restoreTarget.entry.committedAt)}. The public site will not change until you publish.</p>
        <SiteAdminPublicationChanges changes={describeVersionRestore(path, currentSource, restoreTarget.content)} beforeLabel="Current editor" afterLabel="Restored draft" />
        {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}
        <div className={styles.conflictActions}>
          <Button variant="subtle" onClick={() => setRestoreTarget(null)} disabled={busy}>Cancel</Button>
          <Button tone="accent" onClick={() => void restoreVersion()} disabled={busy || currentSource === restoreTarget.content}>Restore draft</Button>
        </div>
      </SiteAdminActionDialog> : null}
    </div>
  );
}
