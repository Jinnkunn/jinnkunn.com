import { useCallback, useEffect, useState } from "react";
import { ListDetailLayout } from "./ListDetailLayout";
import { PostEditor } from "./PostEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";
import type { ItemSelection, PostListRow } from "./types";
import { normalizeString } from "./utils";

export interface PostsPanelProps {
  selected: ItemSelection;
  onSelectedChange: (next: ItemSelection) => void;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePostListRow(raw: unknown): PostListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = normalizeString(r.slug);
  if (!slug) return null;
  return {
    slug,
    href: normalizeString(r.href) || `/blog/${slug}`,
    title: normalizeString(r.title) || slug,
    dateIso: (r.dateIso as string | null) ?? null,
    dateText: (r.dateText as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    draft: asBoolean(r.draft),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    wordCount: asInteger(r.wordCount),
    readingMinutes: asInteger(r.readingMinutes),
    version: normalizeString(r.version),
  };
}

export function PostsPanel({ selected, onSelectedChange }: PostsPanelProps) {
  const { connection, request, setMessage, setPostsIndex } = useSiteAdmin();
  const [rows, setRows] = useState<PostListRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(true);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoadingList(true);
    setError("");
    const path = `/api/site-admin/posts${includeDrafts ? "?drafts=1" : ""}`;
    const response = await request(path, "GET");
    setLoadingList(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      setError(msg);
      setMessage("error", `Load posts failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const rawPosts = Array.isArray(data.posts) ? data.posts : [];
    const parsed: PostListRow[] = [];
    for (const raw of rawPosts) {
      const row = normalizePostListRow(raw);
      if (row) parsed.push(row);
    }
    setRows(parsed);
    setPostsIndex(parsed);
    setMessage("success", `Loaded ${parsed.length} post${parsed.length === 1 ? "" : "s"}.`);
  }, [includeDrafts, ready, request, setMessage, setPostsIndex]);

  useEffect(() => {
    // Auto-load posts list once the connection is ready. The async state
    // writes live inside `refresh` and don't cascade renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void refresh();
  }, [ready, refresh]);

  const onEditorExit = useCallback(
    (action: "saved" | "deleted" | "cancel") => {
      onSelectedChange(null);
      if (action !== "cancel") void refresh();
    },
    [onSelectedChange, refresh],
  );

  // --- Left: list ----------------------------------------------------------
  const listHeader = (
    <div className="list-detail__list-toolbar">
      <label className="list-detail__drafts-toggle">
        <input
          type="checkbox"
          checked={includeDrafts}
          onChange={(event) => setIncludeDrafts(event.target.checked)}
        />
        <span>Drafts</span>
      </label>
      <button
        className="btn btn--ghost list-detail__refresh"
        type="button"
        onClick={() => void refresh()}
        disabled={!ready || loadingList}
      >
        {loadingList ? "…" : "Refresh"}
      </button>
    </div>
  );

  const list =
    rows.length === 0 && !loadingList ? (
      <p className="list-detail__empty">No posts found.</p>
    ) : (
      <ul className="list-detail__rows" role="list">
        {rows.map((row) => {
          const active = selected?.kind === "edit" && selected.slug === row.slug;
          return (
            <li key={row.slug}>
              <button
                type="button"
                className="list-detail__row"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectedChange({ kind: "edit", slug: row.slug })}
              >
                <span className="list-detail__row-title" title={row.title}>
                  {row.title}
                </span>
                <span className="list-detail__row-meta">
                  {row.dateText || row.dateIso || "—"}
                  {row.draft ? (
                    <span className="list-detail__draft-dot" title="Draft">
                      ●
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  // --- Right: detail -------------------------------------------------------
  let detail: React.ReactNode;
  if (selected === null) {
    detail = (
      <div className="list-detail__empty-detail">
        <p>Select a post to edit, or start a new one.</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => onSelectedChange({ kind: "new" })}
          disabled={!ready}
        >
          New post
        </button>
      </div>
    );
  } else if (selected.kind === "new") {
    detail = <PostEditor mode="create" onExit={onEditorExit} />;
  } else {
    detail = (
      <PostEditor
        mode="edit"
        slug={selected.slug}
        onExit={onEditorExit}
        key={selected.slug}
      />
    );
  }

  // --- Header actions ------------------------------------------------------
  const headerActions = (
    <>
      <button
        className="btn btn--primary"
        type="button"
        onClick={() => onSelectedChange({ kind: "new" })}
        disabled={!ready}
      >
        New post
      </button>
      <PublishButton />
    </>
  );

  return (
    <ListDetailLayout
      title="Posts"
      description="MDX-authored blog posts under content/posts/*.mdx."
      headerActions={headerActions}
      listHeader={listHeader}
      list={list}
      detail={detail}
      error={error}
    />
  );
}
