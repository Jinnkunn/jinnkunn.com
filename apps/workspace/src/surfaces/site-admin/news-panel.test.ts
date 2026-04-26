import { describe, expect, it } from "vitest";

import { entriesToMarkdown, markdownToNews } from "./NewsPanel";

describe("news markdown <-> entries bridge", () => {
  it("round-trips title + a single entry", () => {
    const md = entriesToMarkdown({
      title: "News",
      entries: [{ dateIso: "2026-04-26", body: "Hello **world**." }],
    });
    expect(md).toBe("# News\n\n## 2026-04-26\n\nHello **world**.\n");
    const parsed = markdownToNews(md);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.message}`);
    expect(parsed.value.title).toBe("News");
    expect(parsed.value.entries).toEqual([
      { dateIso: "2026-04-26", body: "Hello **world**." },
    ]);
  });

  it("round-trips multiple entries with empty bodies dropped to nothing", () => {
    const md = entriesToMarkdown({
      title: "News",
      entries: [
        { dateIso: "2026-04-25", body: "First" },
        { dateIso: "2026-04-20", body: "" },
        { dateIso: "2026-04-10", body: "Last\n\nMulti-paragraph." },
      ],
    });
    const parsed = markdownToNews(md);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.message}`);
    expect(parsed.value.entries).toEqual([
      { dateIso: "2026-04-25", body: "First" },
      { dateIso: "2026-04-20", body: "" },
      { dateIso: "2026-04-10", body: "Last\n\nMulti-paragraph." },
    ]);
  });

  it("falls back to default title when there is no h1", () => {
    const parsed = markdownToNews("## 2026-04-26\n\nBody only.\n");
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.title).toBe("News");
    expect(parsed.value.entries).toHaveLength(1);
  });

  it("rejects a non-date level-2 heading with the line number", () => {
    const md = "# News\n\n## Random heading\n\nBody.\n";
    const parsed = markdownToNews(md);
    if (parsed.ok) throw new Error("expected parse to fail");
    expect(parsed.error.message).toMatch(/YYYY-MM-DD/);
    expect(parsed.error.line).toBe(3);
  });

  it("treats subsequent h1s as body content of the current entry", () => {
    const md = "# News\n\n## 2026-04-26\n\n# Inner heading\n\nBody.\n";
    const parsed = markdownToNews(md);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.entries[0].body).toBe("# Inner heading\n\nBody.");
  });

  it("ignores stray content before the first date heading", () => {
    const md = "# News\n\nIntro paragraph.\n\n## 2026-04-26\n\nBody.\n";
    const parsed = markdownToNews(md);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.entries).toEqual([
      { dateIso: "2026-04-26", body: "Body." },
    ]);
  });
});
