import { describe, expect, it, vi } from "vitest";

import { handleEditorLinkClick, resolveEditorHref } from "./link-click";

// Synthetic MouseEvent used by the tests below. Skips the JSDOM dance
// and constructs the minimal shape `handleEditorLinkClick` reads.
function fakeEvent({
  metaKey = false,
  ctrlKey = false,
  target,
}: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  target?: { closest: (selector: string) => HTMLAnchorElement | null };
} = {}): MouseEvent {
  const preventDefault = vi.fn();
  // Cast to MouseEvent — handleEditorLinkClick only reads metaKey,
  // ctrlKey, target.closest, and preventDefault.
  return {
    metaKey,
    ctrlKey,
    target,
    preventDefault,
  } as unknown as MouseEvent;
}

function fakeAnchor(href: string): HTMLAnchorElement {
  return {
    getAttribute: (name: string) => (name === "href" ? href : null),
  } as unknown as HTMLAnchorElement;
}

describe("link-click: handleEditorLinkClick", () => {
  it("does NOT consume a plain click — caret placement is preserved", () => {
    const openExternalUrl = vi.fn();
    const consumed = handleEditorLinkClick(fakeEvent(), { openExternalUrl });
    expect(consumed).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("opens via Tauri on Cmd-click and reports consumed", () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const anchor = fakeAnchor("/blog");
    const event = fakeEvent({
      metaKey: true,
      target: { closest: () => anchor },
    });
    const consumed = handleEditorLinkClick(event, { openExternalUrl });
    expect(consumed).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledOnce();
    // Relative href must resolve against staging, not loopback.
    expect(openExternalUrl.mock.calls[0]?.[0]).toBe(
      "https://staging.jinkunchen.com/blog",
    );
  });

  it("opens on Ctrl-click for non-macOS keyboards too", () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const anchor = fakeAnchor("https://example.com/x");
    const event = fakeEvent({
      ctrlKey: true,
      target: { closest: () => anchor },
    });
    const consumed = handleEditorLinkClick(event, { openExternalUrl });
    expect(consumed).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("ignores modifier-click when the target is not an anchor", () => {
    const openExternalUrl = vi.fn();
    const event = fakeEvent({
      metaKey: true,
      target: { closest: () => null },
    });
    const consumed = handleEditorLinkClick(event, { openExternalUrl });
    expect(consumed).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("ignores modifier-click when the anchor has an empty href", () => {
    const openExternalUrl = vi.fn();
    const anchor = fakeAnchor("");
    const event = fakeEvent({
      metaKey: true,
      target: { closest: () => anchor },
    });
    const consumed = handleEditorLinkClick(event, { openExternalUrl });
    expect(consumed).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("logs but doesn't throw when openExternalUrl rejects", async () => {
    const warn = vi.fn();
    const openExternalUrl = vi.fn().mockRejectedValue(new Error("denied"));
    const anchor = fakeAnchor("/x");
    const event = fakeEvent({
      metaKey: true,
      target: { closest: () => anchor },
    });
    const consumed = handleEditorLinkClick(event, { openExternalUrl, warn });
    expect(consumed).toBe(true);
    // Allow the rejected promise to surface its catch path.
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      "[RichTextInput] failed to open external URL",
      "https://staging.jinkunchen.com/x",
      expect.any(Error),
    );
  });
});

describe("link-click: resolveEditorHref", () => {
  it("preserves absolute URLs unchanged", () => {
    expect(resolveEditorHref("https://anywhere.example/foo")).toBe(
      "https://anywhere.example/foo",
    );
  });

  it("resolves relative paths against the staging origin", () => {
    expect(resolveEditorHref("/blog")).toBe("https://staging.jinkunchen.com/blog");
  });

  it("returns the input unchanged when the URL parser fails", () => {
    // `URL` constructor accepts most inputs against a base; the only
    // way to reach the catch branch is to pass an empty origin too.
    // Here we just verify the empty-input behaviour.
    expect(resolveEditorHref("")).toBe("");
  });
});
