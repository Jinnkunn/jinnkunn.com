import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadCalendarProductionSyncPolicy,
  normalizeCalendarProductionSyncPolicy,
  saveCalendarProductionSyncPolicy,
} from "./productionSyncPolicy";

describe("calendar productionSyncPolicy", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
  });

  it("defaults to guarded auto-promotion", () => {
    expect(normalizeCalendarProductionSyncPolicy(null)).toBe("auto-promote");
    expect(normalizeCalendarProductionSyncPolicy("unknown")).toBe("auto-promote");
    expect(loadCalendarProductionSyncPolicy()).toBe("auto-promote");
  });

  it("persists the guarded auto-promote mode", () => {
    saveCalendarProductionSyncPolicy("auto-promote");
    expect(loadCalendarProductionSyncPolicy()).toBe("auto-promote");
  });

  it("persists manual mode as an explicit opt-out", () => {
    saveCalendarProductionSyncPolicy("manual");
    expect(loadCalendarProductionSyncPolicy()).toBe("manual");
  });
});
