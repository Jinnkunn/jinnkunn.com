import { describe, expect, it } from "vitest";

import { applyLink, toggleWrap } from "./format-helpers";

describe("toggleWrap", () => {
  it("wraps a non-empty selection", () => {
    const result = toggleWrap("hello world", 6, 11, "**");
    expect(result.text).toBe("hello **world**");
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(13);
  });

  it("inserts an empty wrapper when selection is collapsed", () => {
    const result = toggleWrap("ab", 1, 1, "*");
    expect(result.text).toBe("a**b");
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(2);
  });

  it("toggles off when the selection is already wrapped", () => {
    const result = toggleWrap("hello **world**", 8, 13, "**");
    expect(result.text).toBe("hello world");
    expect(result.selectionStart).toBe(6);
    expect(result.selectionEnd).toBe(11);
  });

  it("supports asymmetric prefix and suffix", () => {
    const result = toggleWrap("a code b", 2, 6, "`", "`");
    expect(result.text).toBe("a `code` b");
  });

  it("does not toggle when only one side matches — wraps afresh", () => {
    // Selecting "bold" inside "**bold word": the prefix matches but the
    // suffix doesn't (text after "bold" is " word", not "**"), so we add a
    // fresh wrap rather than stripping the leading "**".
    const result = toggleWrap("**bold word", 2, 6, "**");
    expect(result.text).toBe("****bold** word");
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(8);
  });
});

describe("applyLink", () => {
  it("wraps a selected label with a URL", () => {
    const result = applyLink("see docs here", 4, 8, "https://x.dev");
    expect(result.text).toBe("see [docs](https://x.dev) here");
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4 + "[docs](https://x.dev)".length);
  });

  it("uses the URL as the label when nothing is selected", () => {
    const result = applyLink("hi ", 3, 3, "https://x.dev");
    expect(result.text).toBe("hi [https://x.dev](https://x.dev)");
  });
});
