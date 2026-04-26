// Compute the screen-space rect of the caret at a given offset inside a
// <textarea>. There's no DOM API for this, so we render a hidden mirror
// element with the same metrics, place a marker span at the offset, and
// read the marker's position. The mirror is created and removed per call;
// callers are expected to be infrequent (selection change, not keystroke).

const COPY_PROPS: Array<keyof CSSStyleDeclaration> = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
];

export interface CaretCoords {
  top: number;
  left: number;
  height: number;
}

export function getTextareaCaretCoords(
  textarea: HTMLTextAreaElement,
  offset: number,
): CaretCoords {
  const styles = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  // The mirror lives off-screen and replicates the textarea's wrapping
  // behavior so character positions land in the same place.
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.overflow = "hidden";
  for (const prop of COPY_PROPS) {
    // Indexed assignment requires `as any` because CSSStyleDeclaration's
    // numeric indexer fights the keyof lookup at type level.
    (mirror.style as unknown as Record<string, string>)[prop as string] = styles[
      prop
    ] as string;
  }
  const before = textarea.value.substring(0, offset);
  // Adding a textNode preserves leading whitespace; using textContent on
  // the wrapper would collapse trailing whitespace at line ends.
  mirror.appendChild(document.createTextNode(before));
  const marker = document.createElement("span");
  // Non-empty content gives the span a measurable height even at line-end.
  marker.textContent = textarea.value.substring(offset) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const taRect = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(styles.lineHeight) || 18;
  const result: CaretCoords = {
    top: taRect.top + marker.offsetTop - textarea.scrollTop,
    left: taRect.left + marker.offsetLeft - textarea.scrollLeft,
    height: lineHeight,
  };
  document.body.removeChild(mirror);
  return result;
}
