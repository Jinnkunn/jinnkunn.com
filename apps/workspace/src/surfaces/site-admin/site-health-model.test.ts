import { describe, expect, it } from "vitest";

import { deriveSyncHealth, formatSyncAge } from "./site-health-model";

describe("site health model", () => {
  it("prioritizes queued writes over a successful sync", () => {
    const state = deriveSyncHealth(
      { busy: false, error: null, lastSyncAtMs: 10_000, rowCount: 42 },
      { draining: false, failing: 0, pending: 2 },
      20_000,
    );
    expect(state.tone).toBe("warning");
    expect(state.label).toBe("2 pending writes");
  });

  it("shows sync age when the mirror is current", () => {
    const state = deriveSyncHealth(
      { busy: false, error: null, lastSyncAtMs: 20_000, rowCount: 42 },
      null,
      35_000,
    );
    expect(state.tone).toBe("success");
    expect(state.label).toBe("Synced 15s ago");
    expect(state.title).toBe("42 row(s) cached locally");
  });

  it("formats age buckets", () => {
    expect(formatSyncAge(4_000)).toBe("just now");
    expect(formatSyncAge(30_000)).toBe("30s ago");
    expect(formatSyncAge(120_000)).toBe("2m ago");
    expect(formatSyncAge(7_200_000)).toBe("2h ago");
  });
});
