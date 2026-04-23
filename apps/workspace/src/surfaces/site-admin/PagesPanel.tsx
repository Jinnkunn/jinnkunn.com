import { useCallback, useEffect, useState } from "react";
import { PageEditor } from "./PageEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";
import type { PageDetail, PageListRow } from "./types";
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

function normalizePageListRow(raw: unknown): PageListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = normalizeString(r.slug);
  if (!slug) return null;
  return {
    slug,
    href: normalizeString(r.href) || `/pages/${slug}`,
    title: normalizeString(r.title) || slug,
    description: (r.description as string | null) ?? null,
    updatedIso: (r.updatedIso as string | null) ?? null,
    draft: asBoolean(r.draft),
    wordCount: asInteger(r.wordCount),
    readingMinutes: asInteger(r.readingMinutes),
    version: normalizeString(r.version),
  };
}

function normalizePageDetail(raw: unknown): PageDetail | null {
  const base = normalizePageListRow(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === "string" ? r.source : "";
  if (!source) return null;
  return { ...base, source };
}

export function PagesPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [rows, setRows] = useState<PageListRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [mode, setMode] = useState<PanelMode>({ kind: "list" });

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoadingList(true);
    setError("");
    const path = `/api/site-admin/pages${includeDrafts ? "?drafts=1" : ""}`;
    const response = await request(path, "GET");
    setLoadingList(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      setError(msg);
      setMessage("error", `Load pages failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const rawPages = Array.isArray(data.pages) ? data.pages : [];
    const parsed: PageListRow[] = [];
    for (const raw of rawPages) {
      const row = normalizePageListRow(raw);
      if (row) parsed.push(row);
    }
    setRows(parsed);
    setMessage("success", `Loaded ${parsed.length} page${parsed.length === 1 ? "" : "s"}.`);
  }, [includeDrafts, ready, request, setMessage]);

  const loadDetail = useCallback(
    async (slug: string) => {
      setLoadingDetail(true);
      setDetail(null);
      const response = await request(`/api/site-admin/pages/${encodeURIComponent(slug)}`, "GET");
      setLoadingDetail(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Load page failed: ${msg}`);
        return;
      }
      const normalized = normalizePageDetail(response.data);
      if (!normalized) {
        setError("Invalid page payload");
        setMessage("error", "Load page failed: invalid payload");
        return;
      }
      setDetail(normalized);
    },
    [request, setMessage],
  );

  useEffect(() => {
    // Auto-load once the connection is ready. See PostsPanel for rationale.
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

  if (mode.kind === "create") {
    return <PageEditor mode="create" onExit={handleEditorExit} />;
  }
  if (mode.kind === "edit") {
    return <PageEditor mode="edit" slug={mode.slug} onExit={handleEditorExit} />;
  }

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Pages
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Standalone MDX pages under <code>content/pages/*.mdx</code>. Visible at <code>/pages/:slug</code>.
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
            New page
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
              <col style={{ width: "25%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Reading</th>
                <th className="px-3 py-2 font-medium text-right">Draft</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loadingList && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                    No pages found.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
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
                    <td className="px-3 py-2 text-text-primary truncate" title={row.title}>
                      {row.title}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{row.updatedIso || "—"}</td>
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
              Select a page to view its source.
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
                    {detail.updatedIso || "—"}
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
