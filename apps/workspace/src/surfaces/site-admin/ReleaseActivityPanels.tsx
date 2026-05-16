import { useEffect, useRef, useState } from "react";

import type { SiteAdminReleaseJobState } from "../../modules/site-admin/tauri";

export type ReleaseLogLine = {
  id: string;
  atMs: number;
  phase: string;
  stream: string;
  message: string;
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
