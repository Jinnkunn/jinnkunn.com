import { describe, expect, it } from "vitest";

import {
  applyNotesMutation,
  buildNoteBreadcrumb,
  buildNoteTree,
  flattenNoteTree,
  getRecentNotes,
  getSiblingNotes,
  noteIdFromNavItem,
  noteNavId,
  noteTreeToNavItems,
  NOTES_ROOT_NAV_ID,
  parentIdFromNavItem,
} from "./tree";
import type { NoteRow } from "./types";

function note(input: Partial<NoteRow> & Pick<NoteRow, "id" | "title">): NoteRow {
  return {
    archivedAt: null,
    createdAt: 1,
    icon: null,
    parentId: null,
    sortOrder: 0,
    updatedAt: 1,
    ...input,
  };
}

describe("notes tree", () => {
  it("builds a nested tree from flat rows with stable sibling order", () => {
    const rows = [
      note({ id: "c", parentId: "a", sortOrder: 1, title: "Child B" }),
      note({ id: "b", parentId: "a", sortOrder: 0, title: "Child A" }),
      note({ id: "a", sortOrder: 1, title: "Root B" }),
      note({ id: "d", sortOrder: 0, title: "Root A" }),
    ];

    const tree = buildNoteTree(rows);

    expect(tree.map((node) => node.id)).toEqual(["d", "a"]);
    expect(tree[1]?.children.map((node) => node.id)).toEqual(["b", "c"]);
    expect(flattenNoteTree(tree).map((node) => node.id)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("derives sidebar rows that support add, drag, drop, rename, and reorder", () => {
    const tree = buildNoteTree([
      note({ icon: "N", id: "root", title: "Research" }),
      note({ id: "child", parentId: "root", title: "Draft" }),
    ]);

    const [root] = noteTreeToNavItems(tree);

    expect(root).toMatchObject({
      canAddChild: true,
      draggable: true,
      droppable: true,
      id: noteNavId("root"),
      label: "Research",
      orderable: true,
      renameValue: "Research",
    });
    expect(root?.children?.[0]).toMatchObject({
      id: noteNavId("child"),
      label: "Draft",
      renameValue: "Draft",
    });
  });

  it("maps note nav ids and root parent ids", () => {
    expect(noteNavId("abc")).toBe("note:abc");
    expect(noteIdFromNavItem("note:abc")).toBe("abc");
    expect(noteIdFromNavItem(NOTES_ROOT_NAV_ID)).toBeNull();
    expect(parentIdFromNavItem(NOTES_ROOT_NAV_ID)).toBeNull();
    expect(parentIdFromNavItem("note:abc")).toBe("abc");
  });

  it("returns siblings and recents in deterministic order", () => {
    const rows = [
      note({ id: "a", sortOrder: 1, title: "A", updatedAt: 10 }),
      note({ id: "b", sortOrder: 0, title: "B", updatedAt: 20 }),
      note({ id: "c", parentId: "a", sortOrder: 0, title: "C", updatedAt: 30 }),
    ];

    expect(getSiblingNotes(rows, "a").map((row) => row.id)).toEqual(["b", "a"]);
    expect(getRecentNotes(rows, 2).map((row) => row.id)).toEqual(["c", "b"]);
  });

  it("applies mutation patches: removes, replaces, and appends rows", () => {
    const rows = [
      note({ id: "a", sortOrder: 0, title: "A" }),
      note({ id: "b", parentId: "a", sortOrder: 0, title: "B" }),
      note({ id: "c", parentId: "a", sortOrder: 1, title: "C" }),
    ];

    const next = applyNotesMutation(rows, {
      removed: ["b"],
      updated: [
        note({ id: "c", parentId: "a", sortOrder: 0, title: "C2" }),
        note({ id: "d", parentId: "a", sortOrder: 1, title: "D" }),
      ],
    });

    expect(next.map((row) => row.id)).toEqual(["a", "c", "d"]);
    expect(next.find((row) => row.id === "c")?.title).toBe("C2");
  });

  it("returns the original array when mutation is a no-op", () => {
    const rows = [note({ id: "a", title: "A" })];
    const next = applyNotesMutation(rows, { removed: [], updated: [] });
    expect(next).toBe(rows);
  });

  it("builds a breadcrumb path from a note up to the root ancestor", () => {
    const rows = [
      note({ id: "a", title: "Root" }),
      note({ id: "b", parentId: "a", title: "Child" }),
      note({ id: "c", parentId: "b", title: "Grandchild" }),
    ];

    expect(buildNoteBreadcrumb(rows, "c").map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(buildNoteBreadcrumb(rows, "a").map((row) => row.id)).toEqual(["a"]);
    expect(buildNoteBreadcrumb(rows, "missing")).toEqual([]);
  });

  it("stops the breadcrumb at the boundary when an ancestor is missing", () => {
    // Simulates an unarchived child whose parent is still archived: the
    // child references a parent_id that isn't in the live row set.
    const rows = [
      note({ id: "child", parentId: "archived-parent", title: "Child" }),
    ];

    expect(buildNoteBreadcrumb(rows, "child").map((row) => row.id)).toEqual([
      "child",
    ]);
  });
});
