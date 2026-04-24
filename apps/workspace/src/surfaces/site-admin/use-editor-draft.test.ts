import { describe, expect, it } from "vitest";
import { formatDraftAge } from "./use-editor-draft";

describe("formatDraftAge", () => {
  const now = 1_000_000_000_000;

  it("returns 'just now' for timestamps within 30s", () => {
    expect(formatDraftAge(now - 5_000, now)).toBe("just now");
    expect(formatDraftAge(now - 29_000, now)).toBe("just now");
  });

  it("returns seconds under a minute", () => {
    expect(formatDraftAge(now - 35_000, now)).toBe("35s ago");
  });

  it("returns minutes under an hour", () => {
    expect(formatDraftAge(now - 5 * 60_000, now)).toBe("5m ago");
  });

  it("returns hours under a day", () => {
    expect(formatDraftAge(now - 3 * 60 * 60_000, now)).toBe("3h ago");
  });

  it("returns days above 24h", () => {
    expect(formatDraftAge(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(formatDraftAge(now + 10_000, now)).toBe("just now");
  });
});
