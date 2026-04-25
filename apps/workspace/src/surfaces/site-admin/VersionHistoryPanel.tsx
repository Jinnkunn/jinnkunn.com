import { useEffect, useState } from "react";

import { useSiteAdmin } from "./state";
import { normalizeString } from "./utils";

type VersionHistoryEntry = {
  commitSha: string;
  commitShort: string;
  committedAt: string | null;
  authorName: string;
  message: string;
};

function parseHistoryEntry(value: unknown): VersionHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const commitSha = normalizeString(record.commitSha);
  if (!commitSha) return null;
  return {
    commitSha,
    commitShort: normalizeString(record.commitShort) || commitSha.slice(0, 7),
    committedAt: normalizeString(record.committedAt) || null,
    authorName: normalizeString(record.authorName),
    message: normalizeString(record.message),
  };
}

export function VersionHistoryPanel({
  path,
  currentFileSha,
  restoreDisabled,
  onRestored,
}: {
  path: string;
  currentFileSha?: string;
  restoreDisabled?: boolean;
  onRestored: (input: { content: string; fileSha: string }) => void;
}) {
  const { connection, request, setMessage } = useSiteAdmin();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<VersionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState("");
  const [error, setError] = useState("");
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const loadHistory = async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    const response = await request(
      `/api/site-admin/versions?path=${encodeURIComponent(path)}&limit=12`,
      "GET",
    );
    setLoading(false);
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const nextHistory = Array.isArray(data.history)
      ? data.history
          .map(parseHistoryEntry)
          .filter((entry): entry is VersionHistoryEntry => Boolean(entry))
      : [];
    setHistory(nextHistory);
  };

  useEffect(() => {
    if (!open || history.length > 0) return;
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready]);

  const restore = async (entry: VersionHistoryEntry) => {
    if (!ready || restoreDisabled || restoring) return;
    setRestoring(entry.commitSha);
    setError("");
    const response = await request("/api/site-admin/versions", "POST", {
      path,
      commitSha: entry.commitSha,
      expectedFileSha: currentFileSha || "",
    });
    setRestoring("");
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      setMessage("error", `Restore failed: ${response.code}: ${response.error}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const sourceVersion = (data.sourceVersion ?? {}) as Record<string, unknown>;
    const content = typeof data.content === "string" ? data.content : "";
    const fileSha = normalizeString(sourceVersion.fileSha);
    onRestored({ content, fileSha });
    setMessage("success", `Restored ${path} from ${entry.commitShort}.`);
    await loadHistory();
  };

  return (
    <details
      className="version-history"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Version history</span>
        <code>{path}</code>
      </summary>
      <div className="version-history__body">
        <div className="version-history__toolbar">
          <span>
            {restoreDisabled
              ? "Save or discard local changes before restoring."
              : currentFileSha
                ? `Current ${currentFileSha.slice(0, 12)}`
                : "Current file has no saved sha."}
          </span>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadHistory()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && <p className="version-history__error">{error}</p>}
        {history.length === 0 && !loading ? (
          <p className="version-history__empty">No history found for this path.</p>
        ) : (
          <div className="version-history__list">
            {history.map((entry) => (
              <div className="version-history__row" key={entry.commitSha}>
                <div>
                  <strong>{entry.message || "Content update"}</strong>
                  <span>
                    {entry.commitShort}
                    {entry.authorName ? ` · ${entry.authorName}` : ""}
                    {entry.committedAt
                      ? ` · ${new Date(entry.committedAt).toLocaleString()}`
                      : ""}
                  </span>
                </div>
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() => void restore(entry)}
                  disabled={restoreDisabled || Boolean(restoring)}
                >
                  {restoring === entry.commitSha ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
