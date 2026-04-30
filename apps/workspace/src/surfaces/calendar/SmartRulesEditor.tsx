import { useEffect, useState } from "react";

import {
  DEFAULT_SMART_RULES,
  loadActiveRules,
  resetActiveRulesToDefaults,
  saveActiveRules,
  type SmartDefaultRule,
} from "./smartDefaults";
import type { CalendarPublicVisibility } from "./publicProjection";

// Lightweight editor for the smart-default rules used by the
// visibility resolver. Lives in a popover next to the calendar
// toolbar; opens via the "Rules" button. The editor stores a
// working draft of the rules and only commits to localStorage on
// "Save" so an in-progress edit doesn't immediately re-classify
// every event in the surface.

const VISIBILITY_OPTIONS: CalendarPublicVisibility[] = [
  "hidden",
  "busy",
  "titleOnly",
  "full",
];

const REQUIRES_OPTIONS: Array<{
  value: "" | "url" | "location";
  label: string;
}> = [
  { value: "", label: "(none)" },
  { value: "url", label: "url present" },
  { value: "location", label: "location present" },
];

function validatePattern(pattern: string): string | null {
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid regex";
  }
}

export interface SmartRulesEditorProps {
  /** Notifier so CalendarSurface can re-resolve visibility after the
   * operator saves. The hook just bumps a counter; the resolver call
   * sites depend on it via deps lists. */
  onRulesSaved: () => void;
  onClose: () => void;
}

export function SmartRulesEditor({
  onRulesSaved,
  onClose,
}: SmartRulesEditorProps) {
  const [draft, setDraft] = useState<SmartDefaultRule[]>(() =>
    loadActiveRules().map((rule) => ({ ...rule })),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update(index: number, patch: Partial<SmartDefaultRule>) {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
    if (typeof patch.pattern === "string") {
      const err = validatePattern(patch.pattern);
      setErrors((prev) => {
        const out = { ...prev };
        if (err) out[index] = err;
        else delete out[index];
        return out;
      });
    }
  }

  function remove(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const out = { ...prev };
      delete out[index];
      return out;
    });
  }

  function add() {
    setDraft((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}`,
        pattern: "",
        visibility: "titleOnly",
      },
    ]);
  }

  function save() {
    // Validate every pattern. The resolver tolerates bad patterns
    // (skips them at match time) but the editor should fail fast so
    // the operator knows their rule didn't take effect.
    const nextErrors: Record<number, string> = {};
    draft.forEach((rule, idx) => {
      const err = validatePattern(rule.pattern);
      if (err) nextErrors[idx] = err;
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    saveActiveRules(draft);
    onRulesSaved();
    onClose();
  }

  function reset() {
    resetActiveRulesToDefaults();
    setDraft(DEFAULT_SMART_RULES.map((rule) => ({ ...rule })));
    setErrors({});
    onRulesSaved();
  }

  return (
    <div className="smart-rules-editor" role="dialog" aria-label="Smart visibility rules">
      <header className="smart-rules-editor__header">
        <div>
          <h2>Smart visibility rules</h2>
          <p>
            Pattern matches over title / location / notes. The first rule
            to hit decides the visibility, before the per-calendar
            default and global fallback.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <ul className="smart-rules-editor__list">
        {draft.map((rule, idx) => (
          <li key={`${rule.id}-${idx}`} className="smart-rules-editor__row">
            <input
              type="text"
              value={rule.pattern}
              onChange={(e) => update(idx, { pattern: e.target.value })}
              placeholder="regex pattern (case-insensitive)"
              spellCheck={false}
              aria-invalid={errors[idx] ? "true" : "false"}
            />
            <select
              value={rule.visibility}
              onChange={(e) =>
                update(idx, {
                  visibility: e.target.value as CalendarPublicVisibility,
                })
              }
            >
              {VISIBILITY_OPTIONS.map((vis) => (
                <option key={vis} value={vis}>
                  {vis}
                </option>
              ))}
            </select>
            <select
              value={rule.requires ?? ""}
              onChange={(e) =>
                update(idx, {
                  requires: (e.target.value || undefined) as
                    | "url"
                    | "location"
                    | undefined,
                })
              }
              title="Optional: only match when the named field is present"
            >
              {REQUIRES_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="smart-rules-editor__remove"
              onClick={() => remove(idx)}
              aria-label={`Delete rule ${rule.id}`}
              title="Delete rule"
            >
              ×
            </button>
            {errors[idx] ? (
              <p className="smart-rules-editor__error">{errors[idx]}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="smart-rules-editor__footer">
        <button type="button" onClick={add}>
          + Add rule
        </button>
        <button type="button" onClick={reset} title="Replace draft with the bundled starter rules">
          Reset to defaults
        </button>
        <button type="button" className="btn btn--primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
