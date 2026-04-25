import { useCallback } from "react";

import { useDragReorder } from "./shared/useDragReorder";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import {
  createRichTextSection,
  structuredPageSectionLabel,
} from "./structured-page-sections";
import type { StructuredPageSection } from "./types";

interface Props {
  sections: StructuredPageSection[];
  onChange: (next: StructuredPageSection[]) => void;
}

export function StructuredPageSectionsEditor({ sections, onChange }: Props) {
  const reorder = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      if (from >= sections.length || to >= sections.length) return;
      const next = sections.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
    },
    [onChange, sections],
  );

  const { getRowProps, getHandleProps } = useDragReorder(
    sections.length,
    reorder,
  );

  const patch = (index: number, next: Partial<StructuredPageSection>) => {
    onChange(sections.map((section, i) => (i === index ? { ...section, ...next } : section)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = sections.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(sections.filter((_, i) => i !== index));
  };

  return (
    <details className="surface-details" open>
      <summary>Page layout</summary>
      <p className="empty-note">
        Reorder or hide the high-level sections rendered on the public page.
      </p>
      <div className="structured-sections">
        {sections.map((section, index) => (
          <div
            className="structured-section-row"
            key={section.id}
            {...getRowProps(index)}
          >
            <button
              type="button"
              className="drag-handle"
              title="Drag to reorder"
              aria-label="Drag page section to reorder"
              {...getHandleProps(index)}
            >
              ⋮⋮
            </button>
            <label className="structured-section-row__enabled">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(event) => patch(index, { enabled: event.target.checked })}
              />
              <span>{structuredPageSectionLabel(section.type)}</span>
            </label>
            <input
              value={section.title || ""}
              placeholder="Optional heading override"
              onChange={(event) => patch(index, { title: event.target.value || undefined })}
            />
            <select
              value={section.width}
              onChange={(event) =>
                patch(index, {
                  width: event.target.value as StructuredPageSection["width"],
                })
              }
            >
              <option value="narrow">Narrow</option>
              <option value="standard">Standard</option>
              <option value="wide">Wide</option>
            </select>
            <div className="structured-section-row__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move page section up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => move(index, 1)}
                disabled={index === sections.length - 1}
                aria-label="Move page section down"
              >
                ↓
              </button>
              {section.type === "richText" && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => remove(index)}
                  aria-label="Remove rich text section"
                  style={{ color: "var(--color-danger)" }}
                >
                  ×
                </button>
              )}
            </div>
            {section.type === "richText" && (
              <div className="structured-section-row__body">
                <MarkdownEditor
                value={section.body || ""}
                placeholder="Markdown body for this custom section."
                  minHeight={112}
                  showToolbar={false}
                  onChange={(next) => patch(index, { body: next || undefined })}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => onChange([...sections, createRichTextSection()])}
        >
          + Custom text section
        </button>
      </div>
    </details>
  );
}
