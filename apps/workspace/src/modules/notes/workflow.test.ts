import { describe, expect, it } from "vitest";

import {
  dailyNoteBody,
  dailyNoteTitle,
  extractTodosFromNoteBody,
  findNoteByTitle,
  hasQuickNotePrefix,
  parseQuickNoteInput,
} from "./workflow";
import type { NoteRow } from "./api";

describe("notes workflow helpers", () => {
  it("parses explicit quick note prefixes", () => {
    expect(hasQuickNotePrefix("note: idea for local search")).toBe(true);
    expect(hasQuickNotePrefix("笔记 今天想到的结构")).toBe(true);
    expect(hasQuickNotePrefix("+ todo tomorrow")).toBe(false);
  });

  it("creates quick note drafts from the first line", () => {
    expect(parseQuickNoteInput("note: Project handoff\nsend recap")).toEqual({
      bodyMdx: "Project handoff\n\nsend recap",
      preview: "saved to Notes Inbox",
      title: "Project handoff",
    });
  });

  it("finds live notes by title and parent", () => {
    const rows: NoteRow[] = [
      row("a", "Inbox", null),
      row("b", "Inbox", "parent"),
      { ...row("c", "Inbox", null), archivedAt: 1 },
    ];
    expect(findNoteByTitle(rows, " inbox ", null)?.id).toBe("a");
    expect(findNoteByTitle(rows, "Inbox", "parent")?.id).toBe("b");
  });

  it("formats daily note titles and body", () => {
    const date = new Date(2026, 4, 1, 10, 0);
    expect(dailyNoteTitle(date)).toBe("2026-05-01");
    expect(dailyNoteBody(date)).toContain("# 2026-05-01");
  });

  it("extracts unchecked tasks and action section items", () => {
    expect(
      extractTodosFromNoteBody(
        [
          "# Project",
          "- [ ] Send recap",
          "- [x] Done item",
          "TODO: Book venue #ops",
          "## Follow-ups",
          "- Ask for review",
          "- ",
          "## Notes",
          "- Keep as note",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 2, title: "Send recap" },
      { line: 4, title: "Book venue" },
      { line: 6, title: "Ask for review" },
    ]);
  });
});

function row(id: string, title: string, parentId: string | null): NoteRow {
  return {
    archivedAt: null,
    createdAt: 1,
    icon: null,
    id,
    parentId,
    sortOrder: 0,
    title,
    updatedAt: 1,
  };
}
