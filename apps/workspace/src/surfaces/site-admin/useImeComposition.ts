import { useCallback, useEffect, useRef } from "react";
import type {
  ChangeEvent,
  CompositionEvent,
} from "react";

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * IME-safe controlled-input adapter for CJK / multi-keystroke composition.
 *
 * Why this exists: when the user is mid-composition (Pinyin / Kana / Hangul),
 * the browser fires intermediate `change` events with partially-composed
 * keystroke buffers (e.g. "n" → "ni"). If the parent re-renders during that
 * window with the controlled `value` set to one of those intermediate
 * strings, React reconciles it back into the DOM and the IME's own buffer
 * gets clobbered — the user sees their typing dropped or duplicated.
 *
 * The fix: track whether composition is active. While active, swallow
 * `change` events instead of propagating them upstream. Flush the final
 * composed value once on `compositionend`. The parent only sees finished
 * text, never partial IME state.
 *
 * The `commit` callback is captured in a ref so the returned handlers stay
 * referentially stable across renders — important for memoized children.
 */
export function useImeComposition(commit: (next: string) => void) {
  const isComposingRef = useRef(false);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const onChange = useCallback((event: ChangeEvent<TextElement>) => {
    if (isComposingRef.current) return;
    commitRef.current(event.target.value);
  }, []);

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback((event: CompositionEvent<TextElement>) => {
    isComposingRef.current = false;
    // Emit the final, fully-composed value. Some browsers fire `change`
    // *before* `compositionend` with the same value, but firing here is
    // cheap (idempotent on equal strings) and guarantees correctness.
    commitRef.current((event.target as TextElement).value);
  }, []);

  return { onChange, onCompositionStart, onCompositionEnd };
}
