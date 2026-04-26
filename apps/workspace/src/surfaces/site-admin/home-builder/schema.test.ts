import { describe, expect, it } from "vitest";

import {
  normalizeHomeData,
  prepareHomeDataForSave,
  sameData,
} from "./schema";
import type { HomeData } from "../types";

const sampleSection: HomeData["sections"][number] = {
  id: "r",
  type: "richText",
  enabled: true,
  body: "Some prose.",
  variant: "standard",
  tone: "plain",
  textAlign: "left",
  width: "standard",
};

describe("prepareHomeDataForSave", () => {
  it("preserves bodyMdx through the save pipeline", () => {
    // Regression for the migrate flow: clicking Migrate set
    // draft.bodyMdx, but every section mutation + the save payload
    // were piped through prepareHomeDataForSave, which only forwarded
    // title + sections — silently dropping bodyMdx and making the
    // migrate prompt re-appear after any subsequent edit or save.
    const data: HomeData = {
      schemaVersion: 3,
      title: "Hi there!",
      sections: [sampleSection],
      bodyMdx: "<HeroBlock title=\"Welcome\" />\n",
    };
    const out = prepareHomeDataForSave(data);
    expect(out.bodyMdx).toBe("<HeroBlock title=\"Welcome\" />\n");
  });

  it("normalizes blank/whitespace bodyMdx to undefined", () => {
    for (const value of ["", "   \n\n  "]) {
      const data: HomeData = {
        schemaVersion: 3,
        title: "T",
        sections: [sampleSection],
        bodyMdx: value,
      };
      expect(prepareHomeDataForSave(data).bodyMdx).toBeUndefined();
    }
  });

  it("leaves an existing bodyMdx alone when sections are also present", () => {
    // The two content sources coexist intentionally — section-builder
    // still works for users who haven't migrated. Save must not nuke
    // sections just because bodyMdx exists.
    const data: HomeData = {
      schemaVersion: 3,
      title: "T",
      sections: [sampleSection],
      bodyMdx: "Some MDX",
    };
    const out = prepareHomeDataForSave(data);
    expect(out.bodyMdx).toBe("Some MDX");
    expect(out.sections).toHaveLength(1);
  });
});

describe("sameData", () => {
  it("treats bodyMdx changes as dirty", () => {
    const base: HomeData = {
      schemaVersion: 3,
      title: "T",
      sections: [sampleSection],
    };
    const next: HomeData = { ...base, bodyMdx: "Some MDX" };
    expect(sameData(base, next)).toBe(false);
  });
});

describe("normalizeHomeData", () => {
  it("preserves a non-empty bodyMdx round-trip", () => {
    expect(
      normalizeHomeData({ title: "T", bodyMdx: "Hello" }).bodyMdx,
    ).toBe("Hello");
  });
});
