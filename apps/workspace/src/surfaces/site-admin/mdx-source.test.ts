import { describe, expect, it } from "vitest";
import {
  buildPageSource,
  buildPostSource,
  parsePageSource,
  parsePostSource,
  type PageFrontmatterForm,
  type PostFrontmatterForm,
} from "./mdx-source";

describe("buildPostSource / parsePostSource", () => {
  it("round-trips a basic post", () => {
    const form: PostFrontmatterForm = {
      title: "Hello",
      dateIso: "2026-04-23",
      description: "",
      draft: false,
      tags: [],
    };
    const body = "# Hi\n\nBody here.\n";
    const built = buildPostSource(form, body);
    const parsed = parsePostSource(built);
    expect(parsed.form).toEqual(form);
    expect(parsed.body.trimStart()).toBe(body.trimStart());
  });

  it("escapes double quotes in the title", () => {
    const form: PostFrontmatterForm = {
      title: 'He said "hello"',
      dateIso: "2026-04-23",
      description: "",
      draft: false,
      tags: [],
    };
    const built = buildPostSource(form, "body");
    expect(built).toContain('title: "He said \\"hello\\""');
    expect(parsePostSource(built).form.title).toBe('He said "hello"');
  });

  it("emits tags block and parses it back", () => {
    const form: PostFrontmatterForm = {
      title: "T",
      dateIso: "2026-04-23",
      description: "",
      draft: false,
      tags: ["foo", "bar"],
    };
    const built = buildPostSource(form, "body");
    expect(built).toContain("tags:");
    expect(parsePostSource(built).form.tags).toEqual(["foo", "bar"]);
  });

  it("omits description when blank but keeps it when set", () => {
    const blank = buildPostSource(
      {
        title: "T",
        dateIso: "2026-04-23",
        description: "   ",
        draft: false,
        tags: [],
      },
      "body",
    );
    expect(blank).not.toContain("description:");

    const withDesc = buildPostSource(
      {
        title: "T",
        dateIso: "2026-04-23",
        description: "hello",
        draft: false,
        tags: [],
      },
      "body",
    );
    expect(withDesc).toContain('description: "hello"');
    expect(parsePostSource(withDesc).form.description).toBe("hello");
  });

  it("emits draft: true only when draft flag is set", () => {
    const form: PostFrontmatterForm = {
      title: "T",
      dateIso: "2026-04-23",
      description: "",
      draft: true,
      tags: [],
    };
    const built = buildPostSource(form, "body");
    expect(built).toContain("draft: true");
    expect(parsePostSource(built).form.draft).toBe(true);
  });

  it("parses inline tag arrays", () => {
    const source = `---
title: "T"
date: 2026-04-23
tags: ["a", "b"]
---

body`;
    expect(parsePostSource(source).form.tags).toEqual(["a", "b"]);
  });

  it("returns empty form when source lacks frontmatter", () => {
    const parsed = parsePostSource("just a body");
    expect(parsed.form.title).toBe("");
    expect(parsed.body).toBe("just a body");
  });
});

describe("buildPageSource / parsePageSource", () => {
  it("round-trips a basic page", () => {
    const form: PageFrontmatterForm = {
      title: "About",
      description: "About page",
      draft: false,
      updated: "2026-04-23",
    };
    const body = "About me.\n";
    const built = buildPageSource(form, body);
    const parsed = parsePageSource(built);
    expect(parsed.form).toEqual(form);
    expect(parsed.body.trimStart()).toBe(body.trimStart());
  });

  it("omits updated when blank", () => {
    const built = buildPageSource(
      { title: "T", description: "", draft: false, updated: "" },
      "body",
    );
    expect(built).not.toContain("updated:");
  });

  it("handles newlines in description via \\n escape", () => {
    const form: PageFrontmatterForm = {
      title: "T",
      description: "line1\nline2",
      draft: false,
      updated: "",
    };
    const built = buildPageSource(form, "body");
    expect(built).toContain('description: "line1\\nline2"');
    expect(parsePageSource(built).form.description).toBe("line1\nline2");
  });
});
