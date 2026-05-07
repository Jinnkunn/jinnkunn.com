import { describe, expect, it } from "vitest";

import { reorderSiblings } from "./mdx-block-tree";

const seq = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (siblings: { id: string }[]) => siblings.map((s) => s.id);

describe("reorderSiblings", () => {
  it("places the dragged block above the target when dragging downward", () => {
    const start = seq("A", "B", "C", "D");
    const next = reorderSiblings(start, "B", "D", "above");
    expect(ids(next)).toEqual(["A", "C", "B", "D"]);
  });

  it("places the dragged block below the target when dragging downward", () => {
    const start = seq("A", "B", "C", "D");
    const next = reorderSiblings(start, "B", "D", "below");
    expect(ids(next)).toEqual(["A", "C", "D", "B"]);
  });

  it("places the dragged block above the target when dragging upward", () => {
    const start = seq("A", "B", "C", "D");
    const next = reorderSiblings(start, "D", "B", "above");
    expect(ids(next)).toEqual(["A", "D", "B", "C"]);
  });

  it("places the dragged block below the target when dragging upward", () => {
    const start = seq("A", "B", "C", "D");
    const next = reorderSiblings(start, "D", "B", "below");
    expect(ids(next)).toEqual(["A", "B", "D", "C"]);
  });

  it("moves the first block to the end when dropped below the last", () => {
    const start = seq("A", "B", "C");
    const next = reorderSiblings(start, "A", "C", "below");
    expect(ids(next)).toEqual(["B", "C", "A"]);
  });

  it("moves the last block to the start when dropped above the first", () => {
    const start = seq("A", "B", "C");
    const next = reorderSiblings(start, "C", "A", "above");
    expect(ids(next)).toEqual(["C", "A", "B"]);
  });

  it("returns the same array reference for no-op drops", () => {
    const start = seq("A", "B", "C");
    // Drop B above C: B is already directly above C, so no move.
    expect(reorderSiblings(start, "B", "C", "above")).toBe(start);
    // Drop B below A: same story.
    expect(reorderSiblings(start, "B", "A", "below")).toBe(start);
    // Drop on self: ignored.
    expect(reorderSiblings(start, "B", "B", "above")).toBe(start);
    // Unknown ids: ignored.
    expect(reorderSiblings(start, "Z", "A", "above")).toBe(start);
    expect(reorderSiblings(start, "A", "Z", "below")).toBe(start);
    // Empty dragged id: ignored.
    expect(reorderSiblings(start, "", "A", "above")).toBe(start);
  });

  it("does not mutate the input array on a successful move", () => {
    const start = seq("A", "B", "C");
    const snapshot = ids(start);
    reorderSiblings(start, "A", "C", "below");
    expect(ids(start)).toEqual(snapshot);
  });
});
