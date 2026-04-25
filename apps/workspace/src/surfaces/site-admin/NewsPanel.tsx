import { useCallback, useEffect, useMemo, useState } from "react";

import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { useDragReorder } from "./shared/useDragReorder";
import { useSiteAdmin } from "./state";
import type { NewsData, NewsEntry } from "./types";
import { useJsonDraft } from "./use-json-draft";
import { localDateIso } from "./utils";

const BLANK_DATA: NewsData = {
  schemaVersion: 1,
  title: "News",
  entries: [],
};

function clone(value: NewsData): NewsData {
  return JSON.parse(JSON.stringify(value)) as NewsData;
}

function sameData(a: NewsData, b: NewsData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function NewsPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<NewsData>(BLANK_DATA);
  const [draft, setDraft] = useState<NewsData>(BLANK_DATA);
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const dirty = useMemo(() => !sameData(baseData, draft), [baseData, draft]);
  const { restorable, clearDraft, dismissRestore } = useJsonDraft<NewsData>(
    "news",
    draft,
    dirty && !loading && !saving,
  );

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/news", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load news failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as Partial<NewsData>;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: NewsData = {
        schemaVersion: 1,
        title: payload.title || "News",
        description: payload.description,
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      };
      setBaseData(normalized);
      setDraft(clone(normalized));
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) {
        setMessage(
          "success",
          `Loaded ${normalized.entries.length} news entr${normalized.entries.length === 1 ? "y" : "ies"}.`,
        );
      }
    },
    [ready, request, setMessage],
  );

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData({ silent: true });
  }, [ready, loadData]);

  const save = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    const response = await request("/api/site-admin/news", "POST", {
      data: draft,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage(
          "warn",
          "News changed on the server. Reload latest and re-apply.",
        );
        return;
      }
      setError(msg);
      setMessage("error", `Save news failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(draft));
    setFileSha(version.fileSha || "");
    setConflict(false);
    clearDraft();
    setMessage("success", "News saved.");
  }, [ready, saving, request, draft, fileSha, clearDraft, setMessage]);

  const updateEntry = useCallback(
    (index: number, next: Partial<NewsEntry>) => {
      setDraft((d) => ({
        ...d,
        entries: d.entries.map((entry, i) =>
          i === index ? { ...entry, ...next } : entry,
        ),
      }));
    },
    [],
  );

  const move = useCallback((index: number, direction: -1 | 1) => {
    setDraft((d) => {
      const target = index + direction;
      if (target < 0 || target >= d.entries.length) return d;
      const next = d.entries.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, entries: next };
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setDraft((d) => {
      if (
        from < 0 ||
        from >= d.entries.length ||
        to < 0 ||
        to >= d.entries.length ||
        from === to
      ) {
        return d;
      }
      const next = d.entries.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...d, entries: next };
    });
  }, []);

  const { getRowProps, getHandleProps } = useDragReorder(
    draft.entries.length,
    reorder,
  );

  const remove = useCallback((index: number) => {
    setDraft((d) => ({
      ...d,
      entries: d.entries.filter((_, i) => i !== index),
    }));
  }, []);

  const add = useCallback(() => {
    setDraft((d) => ({
      ...d,
      entries: [{ dateIso: localDateIso(), body: "" }, ...d.entries],
    }));
  }, []);

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload latest before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            News
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Dated timeline rendered at <code>/news</code>. Writes to{" "}
            <code>content/news.json</code>. Body field accepts markdown
            (links, bold, italics).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadData()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void save()}
            disabled={!ready || saving || !dirty || conflict}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--color-danger)]">{error}</p>
      )}
      <p className="m-0 text-[12px] text-text-muted">
        {stateNote} · {draft.entries.length} entr
        {draft.entries.length === 1 ? "y" : "ies"}
      </p>

      {restorable && (
        <JsonDraftRestoreBanner
          savedAt={restorable.savedAt}
          onDismiss={dismissRestore}
          onRestore={() => {
            setDraft(clone(restorable.value));
            dismissRestore();
          }}
        />
      )}

      <div className="flex gap-2">
        <button className="btn btn--primary" type="button" onClick={add}>
          + Add entry (newest)
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {draft.entries.length === 0 ? (
          <p className="empty-note">
            No news yet. Click &ldquo;+ Add entry&rdquo; to start.
          </p>
        ) : (
          draft.entries.map((entry, index) => (
            <div className="news-entry-card" key={index} {...getRowProps(index)}>
              <div className="news-entry-header">
                <button
                  type="button"
                  className="drag-handle"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  {...getHandleProps(index)}
                >
                  ⋮⋮
                </button>
                <input
                  type="date"
                  value={entry.dateIso}
                  onChange={(e) => updateEntry(index, { dateIso: e.target.value })}
                  className="news-entry-date"
                />
                <span className="news-entry-index">#{index + 1}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move news entry up"
                    title="Move up (newer position)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, 1)}
                    disabled={index === draft.entries.length - 1}
                    aria-label="Move news entry down"
                    title="Move down (older position)"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{
                      padding: "3px 8px",
                      fontSize: 11,
                      color: "var(--color-danger)",
                    }}
                    onClick={() => remove(index)}
                    aria-label="Remove news entry"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
              <MarkdownEditor
                value={entry.body}
                onChange={(next) => updateEntry(index, { body: next })}
                placeholder="Body (markdown: **bold**, *italic*, [link](url))"
                minHeight={120}
                showToolbar={false}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
