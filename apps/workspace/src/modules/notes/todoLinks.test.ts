import { describe, expect, it } from "vitest";

import {
  buildNoteTodoSource,
  filterTodosLinkedToNote,
  isTodoLinkedToNote,
  parseNoteTodoSource,
} from "./todoLinks";

describe("note todo links", () => {
  it("builds and parses a workspace note source link", () => {
    const source = buildNoteTodoSource({
      id: "note 1",
      title: "Plan ] Launch",
    });

    expect(source).toBe("Source note: [Plan \\] Launch](workspace://notes/note%201)");
    expect(parseNoteTodoSource(source)).toEqual({
      id: "note 1",
      title: "Plan ] Launch",
    });
  });

  it("ignores todos without a note source", () => {
    expect(parseNoteTodoSource("plain notes")).toBeNull();
  });

  it("keeps malformed encoded ids without throwing", () => {
    expect(
      parseNoteTodoSource("Source note: [Broken](workspace://notes/%E0%A4%A)"),
    ).toEqual({
      id: "%E0%A4%A",
      title: "Broken",
    });
  });

  it("filters live todos linked to a note", () => {
    const linkedNotes = buildNoteTodoSource({ id: "note-a", title: "A" });
    const todos = [
      { archivedAt: null, notes: linkedNotes, title: "open" },
      { archivedAt: 1, notes: linkedNotes, title: "archived" },
      {
        archivedAt: null,
        notes: buildNoteTodoSource({ id: "note-b", title: "B" }),
        title: "other",
      },
    ];

    expect(isTodoLinkedToNote(todos[0], "note-a")).toBe(true);
    expect(filterTodosLinkedToNote(todos, "note-a")).toEqual([todos[0]]);
  });
});
