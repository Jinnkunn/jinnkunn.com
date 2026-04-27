// Lists the persistent rename redirects (content/redirects.json) and
// lets the user delete entries that are no longer worth keeping. Each
// row is one (oldSlug → newSlug) mapping that next.config.mjs reads
// at build time to emit a 308 to the new slug.

export interface RedirectsSectionProps {
  pages: Record<string, string>;
  posts: Record<string, string>;
  loading: boolean;
  refreshing: boolean;
  pendingDelete: { kind: "pages" | "posts"; from: string } | null;
  onRefresh: () => void;
  onDelete: (kind: "pages" | "posts", from: string) => void;
  readOnly?: boolean;
}

export function RedirectsSection({
  pages,
  posts,
  loading,
  refreshing,
  pendingDelete,
  onRefresh,
  onDelete,
  readOnly = false,
}: RedirectsSectionProps) {
  const pageEntries = Object.entries(pages).sort(([a], [b]) => a.localeCompare(b));
  const postEntries = Object.entries(posts).sort(([a], [b]) => a.localeCompare(b));
  const total = pageEntries.length + postEntries.length;

  return (
    <details className="surface-details" open>
      <summary>Redirects</summary>
      <div className="flex flex-col gap-3 mt-1">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="m-0 text-[12px] text-text-muted max-w-[640px]">
            Persistent <code>old-slug → new-slug</code> mappings written by
            every successful rename. Take effect at the next deploy via{" "}
            <code>next.config.mjs</code>. Delete entries you no longer need.
          </p>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onRefresh}
            disabled={loading || refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {total === 0 ? (
          <p className="empty-note">
            No redirects yet — every rename writes a fresh entry here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {pageEntries.length > 0 && (
              <RedirectGroup
                kind="pages"
                label="Pages"
                entries={pageEntries}
                pendingDelete={pendingDelete}
                onDelete={onDelete}
                urlBase="/pages/"
                readOnly={readOnly}
              />
            )}
            {postEntries.length > 0 && (
              <RedirectGroup
                kind="posts"
                label="Posts"
                entries={postEntries}
                pendingDelete={pendingDelete}
                onDelete={onDelete}
                urlBase="/blog/"
                readOnly={readOnly}
              />
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function RedirectGroup({
  kind,
  label,
  entries,
  pendingDelete,
  onDelete,
  urlBase,
  readOnly,
}: {
  kind: "pages" | "posts";
  label: string;
  entries: Array<[string, string]>;
  pendingDelete: { kind: "pages" | "posts"; from: string } | null;
  onDelete: (kind: "pages" | "posts", from: string) => void;
  urlBase: string;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-[13px] font-semibold text-text-primary">
        {label}{" "}
        <span className="text-text-muted font-normal">({entries.length})</span>
      </h3>
      <ul className="flex flex-col gap-1.5 m-0 p-0 list-none" role="list">
        {entries.map(([from, to]) => {
          const isDeleting =
            pendingDelete?.kind === kind && pendingDelete.from === from;
          return (
            <li
              key={from}
              className="grid items-center gap-2 border border-border-subtle rounded-[9px] px-2.5 py-1.5 bg-bg-surface"
              style={{
                gridTemplateColumns:
                  "minmax(180px, 1.3fr) auto minmax(180px, 1.3fr) auto",
              }}
            >
              <code className="text-[12px] text-text-primary truncate">{`${urlBase}${from}`}</code>
              <span className="text-text-muted text-[12px]" aria-hidden="true">
                →
              </span>
              <code className="text-[12px] text-text-secondary truncate">{`${urlBase}${to}`}</code>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => onDelete(kind, from)}
                disabled={readOnly || isDeleting}
                aria-label={`Delete redirect from ${urlBase}${from}`}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
