import { describe, expect, it } from "vitest";

import {
  BLANK_HOME_DATA,
  normalizeHomeData,
  prepareHomeDataForSave,
  sameData,
} from "./schema";
import type { HomeData } from "../types";

describe("normalizeHomeData", () => {
  it("returns the BLANK template for non-object input", () => {
    expect(normalizeHomeData(null)).toEqual(BLANK_HOME_DATA);
    expect(normalizeHomeData(undefined)).toEqual(BLANK_HOME_DATA);
    expect(normalizeHomeData("nope")).toEqual(BLANK_HOME_DATA);
    expect(normalizeHomeData(42)).toEqual(BLANK_HOME_DATA);
  });

  it("preserves a non-empty bodyMdx round-trip", () => {
    expect(
      normalizeHomeData({ title: "T", bodyMdx: "Hello" }).bodyMdx,
    ).toBe("Hello");
  });

  it("drops blank/whitespace-only bodyMdx to undefined", () => {
    for (const value of ["", "   \n\n  "]) {
      expect(normalizeHomeData({ title: "T", bodyMdx: value }).bodyMdx).toBeUndefined();
    }
  });

  it("falls back to default title when blank or wrong type", () => {
    expect(normalizeHomeData({ title: "   " }).title).toBe("Hi there!");
    expect(normalizeHomeData({ title: 42 }).title).toBe("Hi there!");
  });

  it("silently drops legacy section data", () => {
    // Older home.json files still load — the dropped sections data
    // disappears on the next save. Smoke-test that the loader doesn't
    // choke on unexpected fields.
    const result = normalizeHomeData({
      title: "T",
      bodyMdx: "body",
      sections: [{ id: "x", type: "hero" }],
    });
    expect(result.title).toBe("T");
    expect(result.bodyMdx).toBe("body");
    expect("sections" in result).toBe(false);
  });
});

describe("prepareHomeDataForSave", () => {
  it("forwards title + bodyMdx through normalize", () => {
    const data: HomeData = {
      schemaVersion: 4,
      title: "Hi there!",
      bodyMdx: "<HeroBlock title=\"Welcome\" />\n",
    };
    expect(prepareHomeDataForSave(data).bodyMdx).toBe(
      "<HeroBlock title=\"Welcome\" />\n",
    );
  });

  it("normalizes blank bodyMdx to undefined", () => {
    expect(
      prepareHomeDataForSave({ schemaVersion: 4, title: "T", bodyMdx: "   " })
        .bodyMdx,
    ).toBeUndefined();
  });
});

describe("sameData", () => {
  it("treats bodyMdx changes as dirty", () => {
    const base = BLANK_HOME_DATA;
    const next: HomeData = { ...base, bodyMdx: "Some MDX" };
    expect(sameData(base, next)).toBe(false);
  });

  it("treats identical drafts as clean", () => {
    expect(sameData(BLANK_HOME_DATA, normalizeHomeData({}))).toBe(true);
  });
});
