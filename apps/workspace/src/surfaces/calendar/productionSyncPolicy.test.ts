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

  it("defaults to manual promotion", () => {
    expect(normalizeCalendarProductionSyncPolicy(null)).toBe("manual");
    expect(normalizeCalendarProductionSyncPolicy("unknown")).toBe("manual");
    expect(loadCalendarProductionSyncPolicy()).toBe("manual");
  });

  it("persists the guarded auto-promote mode", () => {
    saveCalendarProductionSyncPolicy("auto-promote");
    expect(loadCalendarProductionSyncPolicy()).toBe("auto-promote");
  });
});
