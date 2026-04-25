import { useCallback, useEffect, useMemo, useState } from "react";

import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { useDragReorder } from "./shared/useDragReorder";
import { useSiteAdmin } from "./state";
import { StructuredPageSectionsEditor } from "./StructuredPageSectionsEditor";
import {
  normalizeStructuredPageSections,
  WORKS_SECTIONS,
} from "./structured-page-sections";
import type {
  WorksCategoryClient,
  WorksData,
  WorksEntry,
} from "./types";
import { useJsonDraft } from "./use-json-draft";

const BLANK_DATA: WorksData = {
  schemaVersion: 2,
  title: "Works",
  sections: WORKS_SECTIONS,
  entries: [],
};

function clone(value: WorksData): WorksData {
  return JSON.parse(JSON.stringify(value)) as WorksData;
}

function sameData(a: WorksData, b: WorksData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function WorksPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<WorksData>(BLANK_DATA);
  const [draft, setDraft] = useState<WorksData>(BLANK_DATA);
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const dirty = useMemo(() => !sameData(baseData, draft), [baseData, draft]);
  const { restorable, clearDraft, dismissRestore } = useJsonDraft<WorksData>(
    "works",
    draft,
    dirty && !loading && !saving,
  );

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/works", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent)
          setMessage("error", `Load works failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as Partial<WorksData>;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: WorksData = {
        schemaVersion: 2,
        title: payload.title || "Works",
        description: payload.description,
        sections: normalizeStructuredPageSections(payload.sections, WORKS_SECTIONS),
        intro: payload.intro,
        note: payload.note,
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      };
      setBaseData(normalized);
      setDraft(clone(normalized));
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) {
        setMessage(
          "success",
          `Loaded ${normalized.entries.length} work entr${normalized.entries.length === 1 ? "y" : "ies"}.`,
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
    const response = await request("/api/site-admin/works", "POST", {
      data: draft,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage("warn", "Works changed on the server. Reload + re-apply.");
        return;
      }
      setError(msg);
      setMessage("error", `Save works failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(draft));
    setFileSha(version.fileSha || "");
    setConflict(false);
    clearDraft();
    setMessage("success", "Works saved.");
  }, [ready, saving, request, draft, fileSha, clearDraft, setMessage]);

  const updateEntry = useCallback(
    (index: number, next: Partial<WorksEntry>) => {
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
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= d.entries.length ||
        to >= d.entries.length
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

  const addEntry = useCallback((category: WorksCategoryClient) => {
    setDraft((d) => ({
      ...d,
      entries: [
        { category, role: "", period: "" },
        ...d.entries,
      ],
    }));
  }, []);

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload latest before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";

  const recentCount = draft.entries.filter((e) => e.category === "recent").length;
  const passedCount = draft.entries.filter((e) => e.category === "passed").length;

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Works
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Projects + experiences rendered at <code>/works</code>. Writes to{" "}
            <code>content/works.json</code>. Each entry has a category
            (Recent / Passed) + optional markdown description.
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
        {stateNote} · {recentCount} recent · {passedCount} passed
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

      <StructuredPageSectionsEditor
        sections={draft.sections || WORKS_SECTIONS}
        onChange={(next) => setDraft((d) => ({ ...d, sections: next }))}
      />

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Intro (markdown, optional)</span>
        <MarkdownEditor
          value={draft.intro || ""}
          onChange={(next) =>
            setDraft((d) => ({ ...d, intro: next || undefined }))
          }
          placeholder="Shown as a pull-quote at the top of the page."
          minHeight={112}
          showToolbar={false}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Footer note (markdown, optional)</span>
        <MarkdownEditor
          value={draft.note || ""}
          onChange={(next) =>
            setDraft((d) => ({ ...d, note: next || undefined }))
          }
          placeholder="e.g. This list is not exhaustive, and maybe not up-to-date."
          minHeight={112}
          showToolbar={false}
        />
      </label>

      <div className="flex gap-2 flex-wrap">
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => addEntry("recent")}
        >
          + Recent work
        </button>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => addEntry("passed")}
        >
          + Passed work
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {draft.entries.length === 0 ? (
          <p className="empty-note">No work entries yet.</p>
        ) : (
          draft.entries.map((entry, index) => (
            <div className="pubs-entry-card" key={index} {...getRowProps(index)}>
              <div className="pubs-entry-header">
                <button
                  type="button"
                  className="drag-handle"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  {...getHandleProps(index)}
                >
                  ⋮⋮
                </button>
                <span className="pubs-entry-index">#{index + 1}</span>
                <select
                  value={entry.category}
                  onChange={(e) =>
                    updateEntry(index, {
                      category: e.target.value as WorksCategoryClient,
                    })
                  }
                  className="pubs-entry-title-input"
                  style={{ flex: "0 0 140px" }}
                >
                  <option value="recent">Recent</option>
                  <option value="passed">Passed</option>
                </select>
                <input
                  className="pubs-entry-title-input"
                  value={entry.role}
                  placeholder="Role (e.g. Research Assistant)"
                  onChange={(e) => updateEntry(index, { role: e.target.value })}
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move work entry up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, 1)}
                    disabled={index === draft.entries.length - 1}
                    aria-label="Move work entry down"
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
                    aria-label="Remove work entry"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="pubs-entry-grid">
                <label className="pubs-entry-label">
                  Affiliation
                  <input
                    value={entry.affiliation || ""}
                    placeholder="Dalhousie University"
                    onChange={(e) =>
                      updateEntry(index, {
                        affiliation: e.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="pubs-entry-label">
                  Affiliation URL
                  <input
                    value={entry.affiliationUrl || ""}
                    placeholder="https://…"
                    spellCheck={false}
                    onChange={(e) =>
                      updateEntry(index, {
                        affiliationUrl: e.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="pubs-entry-label">
                  Location
                  <input
                    value={entry.location || ""}
                    placeholder="Halifax, NS, Canada"
                    onChange={(e) =>
                      updateEntry(index, {
                        location: e.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="pubs-entry-label">
                  Period
                  <input
                    value={entry.period}
                    placeholder="Sep 2024 - Now"
                    onChange={(e) => updateEntry(index, { period: e.target.value })}
                  />
                </label>
                <label className="pubs-entry-label pubs-entry-label--wide">
                  Description (markdown)
                  <MarkdownEditor
                    value={entry.description || ""}
                    onChange={(next) =>
                      updateEntry(index, {
                        description: next || undefined,
                      })
                    }
                    placeholder="Optional rich body. Supports links, bold, etc."
                    minHeight={120}
                    showToolbar={false}
                  />
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
