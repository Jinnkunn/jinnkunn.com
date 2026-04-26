// Pure text manipulation helpers shared by the inline format toolbar and
// markdown shortcut keybindings. Each function operates on a textarea-style
// (text, selectionStart, selectionEnd) tuple and returns the new text plus
// the new selection range to apply.

export interface SelectionResult {
  selectionEnd: number;
  selectionStart: number;
  text: string;
}

function isAlreadyWrapped(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): boolean {
  if (start - prefix.length < 0) return false;
  if (end + suffix.length > text.length) return false;
  return (
    text.slice(start - prefix.length, start) === prefix &&
    text.slice(end, end + suffix.length) === suffix
  );
}

// Toggle a paired wrapper around the current selection. If the selection is
// already wrapped, the wrapper is stripped (toggling off). When the selection
// is collapsed, the wrapper is inserted at the caret with a zero-width inner
// selection so the user can type inside immediately.
export function toggleWrap(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string = prefix,
): SelectionResult {
  if (start === end) {
    const next = `${text.slice(0, start)}${prefix}${suffix}${text.slice(end)}`;
    return {
      text: next,
      selectionStart: start + prefix.length,
      selectionEnd: start + prefix.length,
    };
  }
  if (isAlreadyWrapped(text, start, end, prefix, suffix)) {
    const next = `${text.slice(0, start - prefix.length)}${text.slice(start, end)}${text.slice(end + suffix.length)}`;
    return {
      text: next,
      selectionStart: start - prefix.length,
      selectionEnd: end - prefix.length,
    };
  }
  const inner = text.slice(start, end);
  const next = `${text.slice(0, start)}${prefix}${inner}${suffix}${text.slice(end)}`;
  return {
    text: next,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + inner.length,
  };
}

// Insert a markdown link around the selection. If the selection is empty,
// the URL becomes the visible text too.
export function applyLink(
  text: string,
  start: number,
  end: number,
  url: string,
): SelectionResult {
  const label = start === end ? url : text.slice(start, end);
  const replacement = `[${label}](${url})`;
  const next = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  return {
    text: next,
    selectionStart: start,
    selectionEnd: start + replacement.length,
  };
}
