"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
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
}: {
  path: string;
  currentSource: string;
  currentVersion: string;
  onRestored: () => Promise<void> | void;
}) {
  const [history, setHistory] = useState<VersionEntry[]>([]);
  const [compare, setCompare] = useState<{ entry: VersionEntry; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      const payload = await versionRequest<VersionPayload>(
        `/api/site-admin/versions?path=${encodeURIComponent(path)}&limit=12`,
      );
      setHistory(payload.history || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setCompare(null);
    void loadHistory();
  }, [loadHistory, currentVersion]);

  async function compareVersion(entry: VersionEntry) {
    setBusy(true);
    setError("");
    try {
      const payload = await versionRequest<VersionPayload>(
        `/api/site-admin/versions?path=${encodeURIComponent(path)}&commitSha=${encodeURIComponent(entry.commitSha)}`,
      );
      if (!payload.version) throw new Error("Version content is unavailable.");
      setCompare({ entry, content: payload.version.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(entry: VersionEntry) {
    if (!window.confirm(`Restore the version from ${formatVersionTime(entry.committedAt)}?`)) return;
    setBusy(true);
    setError("");
    try {
      await versionRequest<VersionPayload>("/api/site-admin/versions", {
        method: "POST",
        body: JSON.stringify({
          path,
          commitSha: entry.commitSha,
          expectedFileSha: currentVersion,
        }),
      });
      setCompare(null);
      await onRestored();
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
        {history.map((entry) => (
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
                disabled={busy}
              >
                Compare
              </Button>
              <Button
                onClick={() => void restoreVersion(entry)}
                variant="ghost"
                size="sm"
                disabled={busy}
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
          <div className={styles.versionCompareGrid}>
            <label>
              <span>Earlier · {compare.entry.commitShort}</span>
              <textarea readOnly value={compare.content} />
            </label>
            <label>
              <span>Current</span>
              <textarea readOnly value={currentSource} />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
