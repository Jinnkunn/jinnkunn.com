import { describe, expect, it } from "vitest";

import { formatBytes, previewSrcForEmbed } from "./mdx-block-renderers";

describe("previewSrcForEmbed", () => {
  it("derives an embed URL from a youtu.be short link", () => {
    expect(previewSrcForEmbed("youtube", "https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("derives an embed URL from a youtube.com watch link", () => {
    expect(
      previewSrcForEmbed("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("derives a vimeo player URL", () => {
    expect(previewSrcForEmbed("vimeo", "https://vimeo.com/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
  });

  it("returns the raw URL for unrecognized providers", () => {
    expect(previewSrcForEmbed("iframe", "https://codepen.io/x/embed")).toBe(
      "https://codepen.io/x/embed",
    );
  });

  it("returns empty string for empty input", () => {
    expect(previewSrcForEmbed("youtube", "")).toBe("");
    expect(previewSrcForEmbed("youtube", "   ")).toBe("");
  });
});

describe("formatBytes", () => {
  it("renders single bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders KB with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1023)).toBe("1023.0 KB");
  });

  it("renders MB with one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
