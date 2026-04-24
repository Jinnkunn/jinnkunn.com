import { useCallback, useEffect, useMemo, useState } from "react";

import { useSiteAdmin } from "./state";
import type {
  TeachingData,
  TeachingEntry,
  TeachingLink,
} from "./types";

const BLANK_DATA: TeachingData = {
  title: "Teaching",
  headerLinks: [],
  entries: [],
  footerLinks: [],
};

function clone(value: TeachingData): TeachingData {
  return JSON.parse(JSON.stringify(value)) as TeachingData;
}

function sameData(a: TeachingData, b: TeachingData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function LinkList({
  label,
  links,
  onChange,
  placeholderLabel,
  placeholderHref,
}: {
  label: string;
  links: TeachingLink[];
  onChange: (next: TeachingLink[]) => void;
  placeholderLabel: string;
  placeholderHref: string;
}) {
  const updateField = (
    index: number,
    key: keyof TeachingLink,
    value: string,
  ) => {
    onChange(
      links.map((link, i) =>
        i === index ? { ...link, [key]: value } : link,
      ),
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = links.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const remove = (index: number) =>
    onChange(links.filter((_, i) => i !== index));
  const add = () => onChange([...links, { label: "", href: "" }]);

  return (
    <details className="surface-details" open>
      <summary>{label}</summary>
      <div className="flex flex-col gap-2 mt-1">
        {links.length === 0 ? (
          <p className="empty-note">No links.</p>
        ) : (
          <>
            <div className="grid-row grid-header pubs-profile-row">
              <span>Label</span>
              <span>URL</span>
              <span>Actions</span>
            </div>
            {links.map((link, index) => (
              <div className="grid-row pubs-profile-row" key={index}>
                <input
                  value={link.label}
                  placeholder={placeholderLabel}
                  onChange={(e) => updateField(index, "label", e.target.value)}
                />
                <input
                  value={link.href}
                  placeholder={placeholderHref}
                  spellCheck={false}
                  onChange={(e) => updateField(index, "href", e.target.value)}
                />
                <div className="flex items-center gap-1">
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
                    disabled={index === links.length - 1}
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
            ))}
          </>
        )}
      </div>
      <div className="flex gap-2 pt-2">
        <button className="btn btn--secondary" type="button" onClick={add}>
          + Add link
        </button>
      </div>
    </details>
  );
}

export function TeachingPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<TeachingData>(BLANK_DATA);
  const [draft, setDraft] = useState<TeachingData>(BLANK_DATA);
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
      const response = await request("/api/site-admin/teaching", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent)
          setMessage("error", `Load teaching failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as Partial<TeachingData>;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: TeachingData = {
        title: payload.title || "Teaching",
        description: payload.description,
        intro: payload.intro,
        headerLinks: Array.isArray(payload.headerLinks) ? payload.headerLinks : [],
        entries: Array.isArray(payload.entries) ? payload.entries : [],
        footerLinks: Array.isArray(payload.footerLinks) ? payload.footerLinks : [],
      };
      setBaseData(normalized);
      setDraft(clone(normalized));
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) {
        setMessage(
          "success",
          `Loaded ${normalized.entries.length} teaching entr${normalized.entries.length === 1 ? "y" : "ies"}.`,
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
    const response = await request("/api/site-admin/teaching", "POST", {
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
          "Teaching changed on the server. Reload latest and re-apply.",
        );
        return;
      }
      setError(msg);
      setMessage("error", `Save teaching failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(draft));
    setFileSha(version.fileSha || "");
    setConflict(false);
    setMessage("success", "Teaching saved.");
  }, [ready, saving, request, draft, fileSha, setMessage]);

  const updateEntry = useCallback(
    (index: number, next: Partial<TeachingEntry>) => {
      setDraft((d) => ({
        ...d,
        entries: d.entries.map((entry, i) =>
          i === index ? { ...entry, ...next } : entry,
        ),
      }));
    },
    [],
  );

  const moveEntry = useCallback((index: number, direction: -1 | 1) => {
    setDraft((d) => {
      const target = index + direction;
      if (target < 0 || target >= d.entries.length) return d;
      const next = d.entries.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, entries: next };
    });
  }, []);

  const removeEntry = useCallback((index: number) => {
    setDraft((d) => ({
      ...d,
      entries: d.entries.filter((_, i) => i !== index),
    }));
  }, []);

  const addEntry = useCallback(() => {
    setDraft((d) => ({
      ...d,
      entries: [
        {
          term: "",
          period: "",
          role: "Instructor",
          courseCode: "",
          courseName: "",
        },
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

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Teaching
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Structured teaching activities rendered at <code>/teaching</code>.
            Writes to <code>content/teaching.json</code>.
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

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Intro (markdown)</span>
        <textarea
          className="news-entry-body"
          rows={2}
          value={draft.intro || ""}
          onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value || undefined }))}
          placeholder="e.g. For the moment, only Dalhousie University activities are listed."
        />
      </label>

      <LinkList
        label="Header Links"
        links={draft.headerLinks}
        onChange={(next) => setDraft((d) => ({ ...d, headerLinks: next }))}
        placeholderLabel="Archived Course Pages"
        placeholderHref="/teaching/archive"
      />

      <details className="surface-details" open>
        <summary>
          Entries{" "}
          <span className="text-[11.5px] text-text-muted">
            ({draft.entries.length})
          </span>
        </summary>
        <div className="flex gap-2 pt-1">
          <button className="btn btn--primary" type="button" onClick={addEntry}>
            + Add entry (newest)
          </button>
        </div>
        <div className="flex flex-col gap-3 mt-2">
          {draft.entries.length === 0 && (
            <p className="empty-note">No teaching entries yet.</p>
          )}
          {draft.entries.map((entry, index) => (
            <div className="pubs-entry-card" key={index}>
              <div className="pubs-entry-header">
                <span className="pubs-entry-index">#{index + 1}</span>
                <input
                  className="pubs-entry-title-input"
                  value={entry.term}
                  placeholder="2024/25 Winter Term"
                  onChange={(e) => updateEntry(index, { term: e.target.value })}
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => moveEntry(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => moveEntry(index, 1)}
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
                    onClick={() => removeEntry(index)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="pubs-entry-grid">
                <label className="pubs-entry-label">
                  Period
                  <input
                    value={entry.period}
                    placeholder="Jan 2025 - April 2025"
                    onChange={(e) => updateEntry(index, { period: e.target.value })}
                  />
                </label>
                <label className="pubs-entry-label">
                  Role
                  <input
                    value={entry.role}
                    placeholder="Instructor / TA / Marker"
                    onChange={(e) => updateEntry(index, { role: e.target.value })}
                  />
                </label>
                <label className="pubs-entry-label">
                  Course Code
                  <input
                    value={entry.courseCode}
                    placeholder="CSCI3141"
                    onChange={(e) =>
                      updateEntry(index, { courseCode: e.target.value })
                    }
                  />
                </label>
                <label className="pubs-entry-label">
                  Course URL (optional)
                  <input
                    value={entry.courseUrl || ""}
                    placeholder="/teaching/archive/…"
                    spellCheck={false}
                    onChange={(e) =>
                      updateEntry(index, {
                        courseUrl: e.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="pubs-entry-label pubs-entry-label--wide">
                  Course Name
                  <input
                    value={entry.courseName}
                    placeholder="Foundations of Data Science"
                    onChange={(e) =>
                      updateEntry(index, { courseName: e.target.value })
                    }
                  />
                </label>
                <label className="pubs-entry-label pubs-entry-label--wide">
                  Instructor (optional)
                  <input
                    value={entry.instructor || ""}
                    placeholder="Dr. Gabriel Spadon"
                    onChange={(e) =>
                      updateEntry(index, {
                        instructor: e.target.value || undefined,
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </details>

      <LinkList
        label="Footer Links"
        links={draft.footerLinks}
        onChange={(next) => setDraft((d) => ({ ...d, footerLinks: next }))}
        placeholderLabel="Appointment"
        placeholderHref="/teaching/appointment"
      />
    </section>
  );
}
