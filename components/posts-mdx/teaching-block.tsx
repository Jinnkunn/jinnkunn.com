import "server-only";

import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TeachingEntry } from "./teaching-entry";

interface TeachingBlockProps {
  /** Cap rendered teaching entries (top of the list first). Omit for
   * all entries. The page MDX already orders entries newest-first. */
  limit?: number;
}

interface TeachingEntryRecord {
  term: string;
  period: string;
  role: string;
  courseCode: string;
  courseName: string;
  courseUrl?: string;
  instructor?: string;
}

const TEACHING_SOURCE_PATH = resolve(
  process.cwd(),
  "content/components/teaching.mdx",
);

// Same self-closing-JSX pattern as the editor's mdx-blocks.ts parser.
const TEACHING_ENTRY_RE = /<TeachingEntry\b([\s\S]*?)\/>/g;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    out[m[1]] = m[2];
  }
  return out;
}

async function loadEntries(): Promise<TeachingEntryRecord[]> {
  let raw = "";
  try {
    raw = await readFile(TEACHING_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  const body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  const out: TeachingEntryRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = TEACHING_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    out.push({
      term: attrs.term ?? "",
      period: attrs.period ?? "",
      role: attrs.role ?? "",
      courseCode: attrs.courseCode ?? "",
      courseName: attrs.courseName ?? "",
      courseUrl: attrs.courseUrl || undefined,
      instructor: attrs.instructor || undefined,
    });
  }
  return out;
}

/** Embeddable view over content/components/teaching.mdx — the
 * dedicated component file edited via the admin Components → Teaching
 * panel. The /teaching public route renders intro / header-links /
 * footer-links from `content/pages/teaching.mdx` and embeds this
 * block to render the entries list. Mirrors the
 * `<ul className="notion-bulleted-list teaching-list">` markup the
 * legacy inline-entries layout used so the embed visually matches
 * the original. */
export async function TeachingBlock({
  limit,
}: TeachingBlockProps): Promise<ReactElement> {
  const entries = await loadEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visible = cap ? entries.slice(0, cap) : entries;

  if (visible.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No teaching activities yet.
      </p>
    );
  }

  return (
    <ul className="notion-bulleted-list teaching-list">
      {visible.map((entry, index) => (
        <TeachingEntry
          key={`${entry.term}-${entry.courseCode}-${index}`}
          term={entry.term}
          period={entry.period}
          role={entry.role}
          courseCode={entry.courseCode}
          courseName={entry.courseName}
          courseUrl={entry.courseUrl}
          instructor={entry.instructor}
        />
      ))}
    </ul>
  );
}
