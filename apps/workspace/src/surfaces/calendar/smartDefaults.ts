// Smart defaults — pattern-based visibility heuristics that fire BEFORE
// the per-calendar default in the resolver chain. Lets the operator
// skip per-event classification on the obvious cases:
//
//   "Office hours – Wed"   → titleOnly  (students should find these)
//   "1:1 with Alice"       → busy       (private check-in)
//   "Lunch with X"         → busy       (private meal)
//   anything with a URL    → titleOnly  (URL is a "share me" signal)
//
// Rules are defined as { match, visibility } pairs. `match` runs over
// the event's title / location / notes / url; the first hit wins.
// Hardcoded defaults ship for the academic-style operator (talks /
// classes / office hours / 1:1s) and can be replaced via localStorage
// for a deployment that needs different conventions.

import type { CalendarPublicVisibility } from "./publicProjection";
import type { CalendarEvent } from "./types";

const STORAGE_KEY = "workspace.calendar.smartDefaults.v1";

export interface SmartDefaultRule {
  /** Human-readable id used in the UI + config dump. Stable across
   * builds so localStorage entries survive code reorders. */
  id: string;
  /** Regex source applied to title, location, and notes (case-
   * insensitive). The first rule whose pattern hits any of these
   * wins. */
  pattern: string;
  /** Visibility to assign when the rule matches. */
  visibility: CalendarPublicVisibility;
  /** When set, also requires this field to be present (truthy) on the
   * event before matching. Used by the "URL → titleOnly" rule which
   * doesn't care about the URL's content, only that one exists. */
  requires?: "url" | "location";
}

// Conservative starter ruleset — fires on common academic / personal
// patterns so a fresh install gets sensible classification without
// the operator touching anything. Order matters: the first rule to
// match wins, so place the most-specific patterns above more-general
// ones.
export const DEFAULT_SMART_RULES: ReadonlyArray<SmartDefaultRule> = [
  {
    id: "office-hours",
    pattern: "office\\s*hours?",
    visibility: "titleOnly",
  },
  {
    id: "one-on-one",
    pattern: "^(?:1:1|1\\s*-on-\\s*1|1\\s+on\\s+1)\\b",
    visibility: "busy",
  },
  {
    id: "private-meal",
    pattern: "^(?:lunch|dinner|breakfast|coffee)\\b",
    visibility: "busy",
  },
  {
    id: "talk",
    pattern: "\\b(?:talk|lecture|seminar|colloquium|keynote)\\b",
    visibility: "titleOnly",
  },
  {
    id: "class-meeting",
    pattern: "\\b(?:cs|csci|stat|math)\\d{3,4}\\b",
    visibility: "titleOnly",
  },
  // Catch-all heuristic: events with a URL are publicly discoverable
  // by definition — promote from "busy" to at least "titleOnly" so
  // the URL is a meaningful signal. Comes last so explicit pattern
  // rules above can still override.
  {
    id: "has-url",
    pattern: ".",
    visibility: "titleOnly",
    requires: "url",
  },
];

/** Read the persisted rule sheet, falling back to `DEFAULT_SMART_RULES`
 * when nothing's stored yet. Exposed so the rule editor UI can show
 * what's currently active without duplicating the parse logic. */
export function loadActiveRules(): ReadonlyArray<SmartDefaultRule> {
  return loadRules();
}

/** Persist a fresh rule sheet. The caller's responsibility to validate
 * that each rule's `pattern` is a parseable regex; the resolver
 * tolerates bad patterns (treats them as no-match) so a typo doesn't
 * crash the surface, but the editor should reject obvious garbage at
 * input time so the operator sees feedback. */
export function saveActiveRules(rules: ReadonlyArray<SmartDefaultRule>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Quota / private mode — degrade silently. Defaults reapply on
    // the next session.
  }
}

/** Drop the operator's customizations and revert to the bundled
 * starter ruleset. Useful when a regex experiment goes sideways and
 * the operator wants a clean baseline back. */
export function resetActiveRulesToDefaults(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function loadRules(): ReadonlyArray<SmartDefaultRule> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SMART_RULES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SMART_RULES;
    const valid = parsed
      .filter(
        (entry): entry is SmartDefaultRule =>
          entry &&
          typeof entry === "object" &&
          typeof entry.id === "string" &&
          typeof entry.pattern === "string" &&
          (entry.visibility === "hidden" ||
            entry.visibility === "busy" ||
            entry.visibility === "titleOnly" ||
            entry.visibility === "full"),
      )
      .map((entry) => ({
        id: entry.id,
        pattern: entry.pattern,
        visibility: entry.visibility,
        requires: entry.requires === "url" || entry.requires === "location"
          ? entry.requires
          : undefined,
      }));
    return valid.length > 0 ? valid : DEFAULT_SMART_RULES;
  } catch {
    return DEFAULT_SMART_RULES;
  }
}

const compiledCache = new WeakMap<
  ReadonlyArray<SmartDefaultRule>,
  Array<{ rule: SmartDefaultRule; regex: RegExp | null }>
>();

function compile(rules: ReadonlyArray<SmartDefaultRule>) {
  const cached = compiledCache.get(rules);
  if (cached) return cached;
  const compiled = rules.map((rule) => {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(rule.pattern, "i");
    } catch {
      regex = null; // bad pattern in localStorage — skip the rule rather than crash
    }
    return { rule, regex };
  });
  compiledCache.set(rules, compiled);
  return compiled;
}

/** Resolve smart-default visibility for an event. Returns null when
 * no rule matches — the caller falls through to per-calendar default
 * + global "busy". */
export function resolveSmartDefault(
  event: CalendarEvent,
  rules: ReadonlyArray<SmartDefaultRule> = loadRules(),
): CalendarPublicVisibility | null {
  const compiled = compile(rules);
  const haystack = [event.title, event.location ?? "", event.notes ?? ""].join(
    "\n",
  );
  for (const { rule, regex } of compiled) {
    if (!regex) continue;
    if (rule.requires === "url" && !event.url) continue;
    if (rule.requires === "location" && !event.location) continue;
    if (regex.test(haystack)) return rule.visibility;
  }
  return null;
}
