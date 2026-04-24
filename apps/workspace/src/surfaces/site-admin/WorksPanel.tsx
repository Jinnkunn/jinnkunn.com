import { useCallback, useEffect, useMemo, useState } from "react";

import { useSiteAdmin } from "./state";
import type {
  WorksCategoryClient,
  WorksData,
  WorksEntry,
} from "./types";

const BLANK_DATA: WorksData = {
  title: "Works",
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
        title: payload.title || "Works",
        description: payload.description,
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
    setMessage("success", "Works saved.");
  }, [ready, saving, request, draft, fileSha, setMessage]);

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

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Intro (markdown, optional)</span>
        <textarea
          className="news-entry-body"
          rows={2}
          value={draft.intro || ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, intro: e.target.value || undefined }))
          }
          placeholder="Shown as a pull-quote at the top of the page."
        />
      </label>

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Footer note (markdown, optional)</span>
        <textarea
          className="news-entry-body"
          rows={2}
          value={draft.note || ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, note: e.target.value || undefined }))
          }
          placeholder="e.g. This list is not exhaustive, and maybe not up-to-date."
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
            <div className="pubs-entry-card" key={index}>
              <div className="pubs-entry-header">
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
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, 1)}
                    disabled={index === draft.entries.length - 1}
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
                    placeholder="https://..."
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
                  <textarea
                    rows={4}
                    value={entry.description || ""}
                    onChange={(e) =>
                      updateEntry(index, {
                        description: e.target.value || undefined,
                      })
                    }
                    placeholder="Optional rich body. Supports links, bold, etc."
                    spellCheck={false}
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
