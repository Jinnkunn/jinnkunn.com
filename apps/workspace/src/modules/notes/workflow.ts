import type { NoteDetail, NoteRow } from "./api";

export const NOTES_INBOX_TITLE = "Inbox";
export const NOTES_DAILY_PARENT_TITLE = "Daily Notes";

export interface QuickNoteDraft {
  bodyMdx: string;
  preview: string;
  title: string;
}

const QUICK_NOTE_PREFIXES = [
  "note:",
  "notes:",
  "n:",
  "笔记:",
  "记:",
  "笔记",
  "记一下",
];

export function hasQuickNotePrefix(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return QUICK_NOTE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function parseQuickNoteInput(input: string): QuickNoteDraft | null {
  const stripped = stripQuickNotePrefix(input);
  if (!stripped) return null;
  const lines = stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const title = normalizeNoteTitle(lines[0]);
  const bodyLines = lines.length > 1 ? lines : [stripped.trim()];
  return {
    bodyMdx: bodyLines.join("\n\n"),
    preview: "saved to Notes Inbox",
    title,
  };
}

export function stripQuickNotePrefix(input: string): string {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  for (const prefix of QUICK_NOTE_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    return trimmed.slice(prefix.length).trim();
  }
  return "";
}

export function normalizeNoteTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || "Untitled").slice(0, 160);
}

export function noteRowFromDetail(detail: NoteDetail): NoteRow {
  return {
    archivedAt: detail.archivedAt,
    createdAt: detail.createdAt,
    icon: detail.icon,
    id: detail.id,
    parentId: detail.parentId,
    sortOrder: detail.sortOrder,
    title: detail.title,
    updatedAt: detail.updatedAt,
  };
}

export function findNoteByTitle(
  rows: readonly NoteRow[],
  title: string,
  parentId: string | null = null,
): NoteRow | null {
  const normalized = title.trim().toLowerCase();
  return (
    rows.find(
      (row) =>
        row.archivedAt === null &&
        (row.parentId ?? null) === parentId &&
        row.title.trim().toLowerCase() === normalized,
    ) ?? null
  );
}

export function dailyNoteTitle(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyNoteBody(date = new Date()): string {
  return `# ${dailyNoteTitle(date)}\n\n## Agenda\n\n- \n\n## Notes\n\n\n## Follow-ups\n\n- `;
}

export type NoteTemplateId = "daily-review" | "meeting" | "project" | "research";

export interface NoteTemplate {
  bodyMdx: string;
  description: string;
  icon: string;
  id: NoteTemplateId;
  title: string;
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    bodyMdx:
      "# Daily Review\n\n## Wins\n\n- \n\n## Open loops\n\n- \n\n## Tomorrow\n\n- ",
    description: "Short personal review with open loops and next actions.",
    icon: "◷",
    id: "daily-review",
    title: "Daily Review",
  },
  {
    bodyMdx:
      "# Meeting Notes\n\n## Context\n\n\n## Decisions\n\n- \n\n## Action items\n\n- ",
    description: "Capture decisions and follow-ups without over-structuring.",
    icon: "◇",
    id: "meeting",
    title: "Meeting Notes",
  },
  {
    bodyMdx:
      "# Project Note\n\n## Goal\n\n\n## Current state\n\n\n## Next steps\n\n- ",
    description: "A lightweight project brief that can grow over time.",
    icon: "□",
    id: "project",
    title: "Project Note",
  },
  {
    bodyMdx:
      "# Research Note\n\n## Question\n\n\n## Sources\n\n- \n\n## Findings\n\n- ",
    description: "Collect research questions, sources, and distilled findings.",
    icon: "✦",
    id: "research",
    title: "Research Note",
  },
];
