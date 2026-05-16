import { useEffect, useRef, useState } from "react";

import type {
  SiteAdminReleaseHistoryEntry,
  SiteAdminReleaseJobState,
} from "../../modules/site-admin/tauri";
import { shortId, shortSha } from "./release-flow-model";

export type ReleaseLogLine = {
  id: string;
  atMs: number;
  phase: string;
  stream: string;
  message: string;
};

type ContentDeltaDisplay = {
  changedRows: number;
  files: Array<{
    relPath: string;
    sizeBytes: number;
    updatedAtMs: number;
    updatedBy: string | null;
  }>;
  truncated: boolean;
};

export function ReleaseJobPanel({
  job,
  lines,
  onRetry,
  scriptLabel,
}: {
  job: SiteAdminReleaseJobState | null;
  lines: ReleaseLogLine[];
  onRetry?: () => void;
  scriptLabel: (script: string) => string;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const [logPreference, setLogPreference] = useState<{
    jobId: string;
    open: boolean;
  } | null>(null);
  const defaultLogsOpen = job?.status !== "succeeded";
  const logsOpen =
    logPreference && logPreference.jobId === job?.job_id
      ? logPreference.open
      : defaultLogsOpen;

  useEffect(() => {
    if (!logsOpen) return;
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [job?.phase, job?.status, lines.length, logsOpen]);

  if (!job && lines.length === 0) return null;
  const finished = job?.status && job.status !== "running";
  return (
    <section
      className="release-center__job"
      data-status={job?.status || "idle"}
      aria-label="Release activity"
    >
      <header>
        <div>
          <h2>{job ? scriptLabel(job.script) : "Release activity"}</h2>
          <p>{job ? `${job.status} · ${job.phase}` : "No release job has run in this session."}</p>
        </div>
        <div className="release-center__job-actions">
          {job?.duration_ms ? <strong>{Math.round(job.duration_ms / 1000)}s</strong> : null}
          {finished ? (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() =>
                setLogPreference({
                  jobId: job?.job_id ?? "session",
                  open: !logsOpen,
                })
              }
            >
              {logsOpen ? "Hide logs" : "Show logs"}
            </button>
          ) : null}
          {onRetry ? (
            <button className="btn btn--secondary" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </header>
      {logsOpen ? (
        <div ref={logRef} className="release-center__log" role="log" aria-live="polite">
          {lines.length > 0 ? (
            lines.map((line) => (
              <div className="release-center__log-line" data-stream={line.stream} key={line.id}>
                <span>{line.phase}</span>
                <code>{line.message}</code>
              </div>
            ))
          ) : (
            <p>Waiting for release output…</p>
          )}
        </div>
      ) : (
        <div className="release-center__log-summary">
          Logs hidden after successful release. Use Show logs if you need the build output.
        </div>
      )}
      {job?.error ? <div className="release-panel__action-error">{job.error}</div> : null}
    </section>
  );
}

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
                <strong>{entry.version_id ? shortId(entry.version_id) : shortSha(entry.sha)}</strong>
                <small>
                  {entry.recorded_at || "-"} · {entry.status}
                  {entry.note ? ` · ${entry.note}` : ""}
                </small>
              </div>
              <div className="release-center__history-actions">
                {entry.rollback_command ? (
                  <button className="btn btn--secondary" type="button" onClick={() => onCopyRollback(entry)}>
                    Copy Rollback
                  </button>
                ) : null}
                {entry.env === "production" && entry.version_id ? (
                  <button className="btn btn--danger" type="button" onClick={() => onRollback(entry)}>
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

export function ContentDeltaDetails({
  delta,
  formatBytes,
  formatRelativeTime,
}: {
  delta: ContentDeltaDisplay;
  formatBytes: (bytes: number) => string;
  formatRelativeTime: (ms: number) => string;
}) {
  return (
    <details
      className="release-panel__content-delta"
      aria-label="Files that will land on production"
    >
      <summary>
        <span>What will land on production</span>
        <strong>
          {delta.changedRows} file{delta.changedRows === 1 ? "" : "s"}
        </strong>
      </summary>
      <ul>
        {delta.files.map((file) => (
          <li key={file.relPath}>
            <code>{file.relPath}</code>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(file.sizeBytes)}</span>
            {file.updatedAtMs ? (
              <>
                <span aria-hidden="true">·</span>
                <time
                  dateTime={new Date(file.updatedAtMs).toISOString()}
                  title={new Date(file.updatedAtMs).toLocaleString()}
                >
                  {formatRelativeTime(file.updatedAtMs)}
                </time>
              </>
            ) : null}
            {file.updatedBy ? (
              <>
                <span aria-hidden="true">·</span>
                <span>by {file.updatedBy}</span>
              </>
            ) : null}
          </li>
        ))}
        {delta.truncated ? (
          <li className="release-panel__content-delta-more">
            + {delta.changedRows - delta.files.length} more
          </li>
        ) : null}
      </ul>
    </details>
  );
}
