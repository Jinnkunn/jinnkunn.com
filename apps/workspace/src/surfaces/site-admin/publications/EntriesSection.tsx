import { useCallback } from "react";

import { useDragReorder } from "../shared/useDragReorder";
import type { PublicationEntry } from "../types";

export interface EntriesSectionProps {
  entries: PublicationEntry[];
  onChange: (next: PublicationEntry[]) => void;
}

const LABEL_OPTIONS = [
  { value: "conference", label: "Conference" },
  { value: "journal", label: "Journal" },
  { value: "workshop", label: "Workshop" },
  { value: "preprint", label: "Preprint" },
  { value: "arXiv", label: "arXiv" },
  { value: "thesis", label: "Thesis" },
  { value: "other", label: "Other" },
];

function authorsToInput(authors?: string[]): string {
  return (authors || []).join(", ");
}

function authorsFromInput(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function externalUrlsToInput(urls?: string[]): string {
  return (urls || []).join("\n");
}

function externalUrlsFromInput(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EntriesSection({ entries, onChange }: EntriesSectionProps) {
  const updateField = useCallback(
    <K extends keyof PublicationEntry>(
      index: number,
      key: K,
      value: PublicationEntry[K],
    ) => {
      onChange(
        entries.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)),
      );
    },
    [entries, onChange],
  );

  const toggleLabel = useCallback(
    (index: number, label: string) => {
      onChange(
        entries.map((entry, i) => {
          if (i !== index) return entry;
          const has = entry.labels.includes(label);
          return {
            ...entry,
            labels: has
              ? entry.labels.filter((l) => l !== label)
              : [...entry.labels, label],
          };
        }),
      );
    },
    [entries, onChange],
  );

  const move = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= entries.length) return;
      const next = entries.slice();
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [entries, onChange],
  );

  const reorder = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || from >= entries.length) return;
      if (to < 0 || to >= entries.length) return;
      const next = entries.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
    },
    [entries, onChange],
  );

  const { getRowProps, getHandleProps } = useDragReorder(entries.length, reorder);

  const remove = useCallback(
    (index: number) => onChange(entries.filter((_, i) => i !== index)),
    [entries, onChange],
  );

  const add = useCallback(() => {
    const currentYear = String(new Date().getFullYear());
    onChange([
      ...entries,
      {
        title: "",
        year: currentYear,
        url: "",
        labels: [],
        authors: [],
      },
    ]);
  }, [entries, onChange]);

  return (
    <details className="surface-details" open>
      <summary>
        Entries{" "}
        <span className="text-[11.5px] text-text-muted">({entries.length})</span>
      </summary>
      <div className="flex flex-col gap-3 mt-2">
        {entries.length === 0 && (
          <p className="empty-note">No publications yet. Click &ldquo;+ Add entry&rdquo; to start.</p>
        )}
        {entries.map((entry, index) => (
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
              <input
                className="pubs-entry-title-input"
                value={entry.title}
                placeholder="Paper title"
                onChange={(e) => updateField(index, "title", e.target.value)}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move publication up"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => move(index, 1)}
                  disabled={index === entries.length - 1}
                  aria-label="Move publication down"
                  title="Move down"
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
                  aria-label="Remove publication"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="pubs-entry-grid">
              <label className="pubs-entry-label">
                Year
                <input
                  value={entry.year}
                  placeholder="2025"
                  onChange={(e) => updateField(index, "year", e.target.value)}
                />
              </label>
              <label className="pubs-entry-label">
                URL
                <input
                  value={entry.url}
                  placeholder="https://…"
                  spellCheck={false}
                  onChange={(e) => updateField(index, "url", e.target.value)}
                />
              </label>
              <label className="pubs-entry-label pubs-entry-label--wide">
                Authors (comma-separated; use &ldquo;*&rdquo; suffix for self — e.g. &ldquo;Jinkun Chen*&rdquo;)
                <input
                  value={authorsToInput(entry.authors)}
                  placeholder="A. Author, B. Author*, C. Author"
                  onChange={(e) =>
                    updateField(index, "authors", authorsFromInput(e.target.value))
                  }
                />
              </label>
              <label className="pubs-entry-label pubs-entry-label--wide">
                Venue
                <input
                  value={entry.venue || ""}
                  placeholder="NeurIPS 2025 / IEEE Trans on …"
                  onChange={(e) =>
                    updateField(index, "venue", e.target.value || undefined)
                  }
                />
              </label>
              <label className="pubs-entry-label">
                DOI URL
                <input
                  value={entry.doiUrl || ""}
                  placeholder="https://doi.org/…"
                  spellCheck={false}
                  onChange={(e) =>
                    updateField(index, "doiUrl", e.target.value || undefined)
                  }
                />
              </label>
              <label className="pubs-entry-label">
                arXiv URL
                <input
                  value={entry.arxivUrl || ""}
                  placeholder="https://arxiv.org/abs/…"
                  spellCheck={false}
                  onChange={(e) =>
                    updateField(index, "arxivUrl", e.target.value || undefined)
                  }
                />
              </label>
              <label className="pubs-entry-label pubs-entry-label--wide">
                External URLs (one per line)
                <textarea
                  rows={2}
                  value={externalUrlsToInput(entry.externalUrls)}
                  spellCheck={false}
                  onChange={(e) =>
                    updateField(
                      index,
                      "externalUrls",
                      externalUrlsFromInput(e.target.value),
                    )
                  }
                />
              </label>
              <div className="pubs-entry-label pubs-entry-label--wide">
                <span>Labels</span>
                <div className="flex flex-wrap gap-1.5">
                  {LABEL_OPTIONS.map((opt) => {
                    const selected = entry.labels.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pubs-label-chip${selected ? " pubs-label-chip--selected" : ""}`}
                        onClick={() => toggleLabel(index, opt.value)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        <button className="btn btn--primary" type="button" onClick={add}>
          + Add entry
        </button>
      </div>
    </details>
  );
}
