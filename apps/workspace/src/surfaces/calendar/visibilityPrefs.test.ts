import { describe, expect, it } from "vitest";

import { reconcileVisibility } from "./visibilityPrefs";

// Pure-function coverage for the calendar visibility reconciliation.
// The state machine here is small but easy to break: a regression
// would silently default newly-added Apple Calendar entries to hidden,
// or worse, blow away the operator's saved toggles on every relaunch.

describe("calendar visibilityPrefs: reconcileVisibility", () => {
  it("first-launch path defaults every loaded calendar to visible", () => {
    const result = reconcileVisibility(["a", "b", "c"], null);
    expect(result.visible).toEqual(new Set(["a", "b", "c"]));
    expect(result.knownIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("preserves the operator's previous toggles for known calendars", () => {
    const result = reconcileVisibility(
      ["a", "b", "c"],
      {
        visible: new Set(["a"]), // user has b + c hidden
        knownIds: new Set(["a", "b", "c"]),
      },
    );
    expect(result.visible).toEqual(new Set(["a"]));
    expect(result.knownIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("defaults a brand-new calendar to visible without disturbing existing toggles", () => {
    const result = reconcileVisibility(
      ["a", "b", "c", "d"], // d is new since last load
      {
        visible: new Set(["a"]), // user has b + c hidden
        knownIds: new Set(["a", "b", "c"]),
      },
    );
    expect(result.visible).toEqual(new Set(["a", "d"]));
    expect(result.knownIds).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("leaves orphaned ids in knownIds (deleted calendars stay tracked, harmless)", () => {
    // The OS deleted "c" — `loadedIds` no longer contains it, but the
    // operator's "I had c hidden" history shouldn't get clobbered. If
    // they ever bring c back the existing toggle is honored.
    const result = reconcileVisibility(
      ["a", "b"],
      {
        visible: new Set(["a"]),
        knownIds: new Set(["a", "b", "c"]),
      },
    );
    expect(result.visible).toEqual(new Set(["a"]));
    expect(result.knownIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("returns disjoint Set instances so callers can mutate without leaking back", () => {
    const prev = {
      visible: new Set(["a"]),
      knownIds: new Set(["a", "b"]),
    };
    const result = reconcileVisibility(["a", "b"], prev);
    expect(result.visible).not.toBe(prev.visible);
    expect(result.knownIds).not.toBe(prev.knownIds);
    // Mutating the result must not retroactively change `prev`.
    result.visible.add("zzz");
    expect(prev.visible.has("zzz")).toBe(false);
  });
});
