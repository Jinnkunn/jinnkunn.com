// Editor link click intercept — extracted so it can be unit-tested
// without spinning up TipTap. The behavior the operator depends on:
//
//   - Plain click (no modifier): return false → ProseMirror handles
//     the click as caret placement.
//   - Cmd-click (macOS) or Ctrl-click: prevent the default editor
//     action, resolve the href against the staging origin (so
//     `/blog` becomes https://staging.jinkunchen.com/blog rather
//     than the dev server's loopback), and ask the OS browser to
//     open the URL via Tauri's `open_external_url`.
//
// The handler is intentionally synchronous and side-effect-bounded
// (it kicks off the open call but doesn't await it) so the caller's
// "return true to consume" contract stays clean.

const STAGING_ORIGIN = "https://staging.jinkunchen.com";

export interface HandleEditorLinkClickEnv {
  /** Tauri command that hands a URL to the OS browser. Tested with a
   * sync mock that records the call. */
  openExternalUrl: (url: string) => Promise<void>;
  /** Hook for surfacing failures that aren't the user's problem. The
   * production path uses `console.warn`; tests can spy on it. */
  warn?: (message: string, ...rest: unknown[]) => void;
}

/** Resolve the editor href against the staging origin so a relative
 * `/blog` doesn't end up at the dev server's loopback. Absolute URLs
 * pass through unchanged. Returns the input on parse failure rather
 * than throwing, so callers can blindly use the result. */
export function resolveEditorHref(
  href: string,
  origin: string = STAGING_ORIGIN,
): string {
  if (!href) return href;
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

/** Returns `true` when ProseMirror should treat the click as
 * consumed (we kicked off an OS-browser open) and `false` otherwise.
 * The boolean shape matches TipTap's `handleClick` contract. */
export function handleEditorLinkClick(
  event: MouseEvent,
  env: HandleEditorLinkClickEnv,
): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return false;
  const raw = anchor.getAttribute("href") ?? "";
  if (!raw) return false;
  const resolved = resolveEditorHref(raw);
  event.preventDefault();
  const warn = env.warn ?? console.warn;
  void env.openExternalUrl(resolved).catch((error: unknown) => {
    warn("[RichTextInput] failed to open external URL", resolved, error);
  });
  return true;
}
