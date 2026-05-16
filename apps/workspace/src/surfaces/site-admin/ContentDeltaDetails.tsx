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
