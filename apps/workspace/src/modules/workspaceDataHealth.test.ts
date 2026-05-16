import { describe, expect, it } from "vitest";

import {
  deriveWorkspaceDataHealth,
  workspaceDataHealthLabel,
  workspaceDataHealthTone,
} from "./workspaceDataHealth";

describe("workspaceDataHealth", () => {
  it("distinguishes first load, refresh, stale, and hard failure", () => {
    expect(
      deriveWorkspaceDataHealth({
        hasData: false,
        hasLoaded: false,
        loading: true,
      }).state,
    ).toBe("loading");

    expect(
      deriveWorkspaceDataHealth({
        hasData: true,
        hasLoaded: true,
        loading: true,
      }).state,
    ).toBe("syncing");

    expect(
      deriveWorkspaceDataHealth({
        error: new Error("offline"),
        hasData: true,
        hasLoaded: true,
        loading: false,
      }).state,
    ).toBe("stale");

    expect(
      deriveWorkspaceDataHealth({
        error: new Error("offline"),
        hasData: false,
        hasLoaded: false,
        loading: false,
      }).state,
    ).toBe("error");
  });

  it("maps states to compact UI labels and tones", () => {
    const health = deriveWorkspaceDataHealth({
      hasData: true,
      hasLoaded: true,
      loading: false,
      source: "mixed",
      summary: "8 events",
    });

    expect(workspaceDataHealthLabel(health)).toBe("Up to date");
    expect(workspaceDataHealthTone(health.state)).toBe("success");
  });
});
