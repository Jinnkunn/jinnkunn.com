import { useCallback, useEffect, useMemo, useState } from "react";
import { PostEditor } from "./PostEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";
import type { PostDetail, PostListRow } from "./types";
import { normalizeString } from "./utils";

type PanelMode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; slug: string };

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

function normalizePostDetail(raw: unknown): PostDetail | null {
  const base = normalizePostListRow(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === "string" ? r.source : "";
  if (!source) return null;
  return { ...base, source };
}

export function PostsPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [rows, setRows] = useState<PostListRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [mode, setMode] = useState<PanelMode>({ kind: "list" });

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
    setMessage("success", `Loaded ${parsed.length} post${parsed.length === 1 ? "" : "s"}.`);
  }, [includeDrafts, ready, request, setMessage]);

  const loadDetail = useCallback(
    async (slug: string) => {
      setLoadingDetail(true);
      setDetail(null);
      const response = await request(`/api/site-admin/posts/${encodeURIComponent(slug)}`, "GET");
      setLoadingDetail(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Load post failed: ${msg}`);
        return;
      }
      const normalized = normalizePostDetail(response.data);
      if (!normalized) {
        setError("Invalid post payload");
        setMessage("error", "Load post failed: invalid payload");
        return;
      }
      setDetail(normalized);
    },
    [request, setMessage],
  );

  useEffect(() => {
    // Auto-load the posts list once the connection becomes ready. This is a
    // standard data-fetch-on-mount pattern; the setState lives inside the
    // async `refresh`, not the effect body, and does not cascade renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void refresh();
  }, [ready, refresh]);

  const handleSelect = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      void loadDetail(slug);
    },
    [loadDetail],
  );

  const handleEditorExit = useCallback(
    (action: "saved" | "deleted" | "cancel") => {
      setMode({ kind: "list" });
      if (action !== "cancel") {
        setSelectedSlug(null);
        setDetail(null);
        void refresh();
      }
    },
    [refresh],
  );

  const visibleRows = useMemo(() => rows, [rows]);

  if (mode.kind === "create") {
    return <PostEditor mode="create" onExit={handleEditorExit} />;
  }
  if (mode.kind === "edit") {
    return <PostEditor mode="edit" slug={mode.slug} onExit={handleEditorExit} />;
  }

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Posts
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            MDX-authored blog posts under <code>content/posts/*.mdx</code>. Select a row to inspect its source.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
            <input
              type="checkbox"
              checked={includeDrafts}
              onChange={(event) => setIncludeDrafts(event.target.checked)}
            />
            <span>Include drafts</span>
          </label>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={!ready || loadingList}
          >
            {loadingList ? "Loading…" : "Refresh"}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => setMode({ kind: "create" })}
            disabled={!ready}
          >
            New post
          </button>
          <PublishButton />
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--text-danger,#b02a37)]">{error}</p>
      )}

      <div className="flex gap-4" style={{ minHeight: 320 }}>
        <div
          className="flex-1 overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface"
          style={{ minWidth: 0 }}
        >
          <table className="w-full text-[12.5px]" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "55%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Reading</th>
                <th className="px-3 py-2 font-medium text-right">Draft</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && !loadingList && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                    No posts found.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => {
                const selected = row.slug === selectedSlug;
                return (
                  <tr
                    key={row.slug}
                    className="cursor-pointer"
                    aria-selected={selected}
                    style={{
                      background: selected ? "var(--bg-subtle,#f4f4f4)" : "transparent",
                    }}
                    onClick={() => handleSelect(row.slug)}
                  >
                    <td
                      className="px-3 py-2 text-text-primary truncate"
                      title={row.title}
                    >
                      {row.title}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {row.dateText || row.dateIso || "—"}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {row.readingMinutes > 0 ? `${row.readingMinutes} min` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-text-muted">
                      {row.draft ? "●" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside
          className="w-[48%] overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface flex flex-col"
          style={{ minWidth: 0 }}
        >
          {!selectedSlug ? (
            <div className="flex-1 flex items-center justify-center text-[12.5px] text-text-muted">
              Select a post to view its frontmatter and body source.
            </div>
          ) : loadingDetail ? (
            <div className="flex-1 flex items-center justify-center text-[12.5px] text-text-muted">
              Loading…
            </div>
          ) : detail ? (
            <>
              <header className="px-3 py-2 border-b border-border-subtle flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[13px] font-semibold text-text-primary truncate"
                    title={detail.title}
                  >
                    {detail.title}
                  </div>
                  <div className="text-[11.5px] text-text-muted truncate">
                    {detail.dateText || detail.dateIso || "—"}
                    {" · "}
                    {detail.href}
                    {detail.draft ? " · draft" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ padding: "3px 10px", fontSize: 12 }}
                  onClick={() => setMode({ kind: "edit", slug: detail.slug })}
                >
                  Edit
                </button>
              </header>
              <pre
                className="debug-pane flex-1 m-0 overflow-auto"
                style={{ fontSize: 12, lineHeight: 1.5 }}
              >
                {detail.source}
              </pre>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
