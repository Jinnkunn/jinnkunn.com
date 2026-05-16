import type { SiteAdminReleaseHistoryEntry } from "../../modules/site-admin/tauri";
import { shortId, shortSha } from "./release-flow-model";

export function ReleaseHistoryPanel({
  entries,
  error,
  onCopyRollback,
  onRollback,
}: {
  entries: SiteAdminReleaseHistoryEntry[];
  error: string;
  onCopyRollback: (entry: SiteAdminReleaseHistoryEntry) => void;
  onRollback: (entry: SiteAdminReleaseHistoryEntry) => void;
}) {
  return (
    <section className="release-center__history" aria-label="Release history">
      <header>
        <div>
          <h2>Release History</h2>
          <p>Recent local releases and production snapshots.</p>
        </div>
        <span>{entries.length}</span>
      </header>
      {error ? <div className="release-panel__action-error">{error}</div> : null}
      {entries.length > 0 ? (
        <div className="release-center__history-list">
          {entries.map((entry, index) => (
            <div
              className="release-center__history-row"
              data-status={entry.status}
              key={`${entry.source}:${entry.version_id}:${entry.recorded_at}:${index}`}
            >
              <div>
                <span>{entry.env || entry.source}</span>
                <strong>
                  {entry.version_id ? shortId(entry.version_id) : shortSha(entry.sha)}
                </strong>
                <small>
                  {entry.recorded_at || "-"} · {entry.status}
                  {entry.note ? ` · ${entry.note}` : ""}
                </small>
              </div>
              <div className="release-center__history-actions">
                {entry.rollback_command ? (
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => onCopyRollback(entry)}
                  >
                    Copy Rollback
                  </button>
                ) : null}
                {entry.env === "production" && entry.version_id ? (
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={() => onRollback(entry)}
                  >
                    Rollback
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="release-center__empty">No local release history yet.</div>
      )}
    </section>
  );
}
