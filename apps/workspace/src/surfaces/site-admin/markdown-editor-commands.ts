// Markdown-source transforms for the CodeMirror-based editor.
// Each helper operates on a CodeMirror EditorView and dispatches a single
// transaction so undo/redo works cleanly. Keeping this module pure (no React
// imports) lets the toolbar + keymap + slash menu share the same primitives.

import type { EditorView } from "@codemirror/view";

function lineStart(view: EditorView, pos: number): number {
  return view.state.doc.lineAt(pos).from;
}

function lineEnd(view: EditorView, pos: number): number {
  return view.state.doc.lineAt(pos).to;
}

/** Wrap the primary selection with a prefix + suffix. If the selection is
 * empty, inserts `${prefix}${suffix}` and places the caret between them so
 * the user can start typing immediately. Already-wrapped selections get
 * unwrapped (markdown-friendly toggle behavior). */
export function wrapSelection(
  view: EditorView,
  prefix: string,
  suffix: string = prefix,
): void {
  const selection = view.state.selection.main;
  const { from, to } = selection;
  const selected = view.state.sliceDoc(from, to);
  const isEmpty = from === to;

  // Toggle off if already wrapped.
  const beforeText = view.state.sliceDoc(Math.max(0, from - prefix.length), from);
  const afterText = view.state.sliceDoc(to, to + suffix.length);
  if (!isEmpty && beforeText === prefix && afterText === suffix) {
    view.dispatch({
      changes: [
        { from: from - prefix.length, to: from, insert: "" },
        { from: to, to: to + suffix.length, insert: "" },
      ],
      selection: { anchor: from - prefix.length, head: to - prefix.length },
    });
    view.focus();
    return;
  }

  const insert = `${prefix}${selected}${suffix}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: isEmpty
      ? { anchor: from + prefix.length }
      : { anchor: from + prefix.length, head: from + prefix.length + selected.length },
  });
  view.focus();
}

/** Toggle a line-prefix across every line in the selection (or just the
 * current line if the selection is empty). Used for headings, quotes,
 * bullet lists, etc. Idempotent: applying twice removes the prefix. */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let allHavePrefix = true;
  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
    const line = view.state.doc.line(lineNo);
    if (!line.text.startsWith(prefix)) allHavePrefix = false;
  }
  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
    const line = view.state.doc.line(lineNo);
    if (allHavePrefix) {
      if (line.text.startsWith(prefix)) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      }
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }
  if (changes.length === 0) return;
  view.dispatch({ changes });
  view.focus();
}

/** Replace the current line (or insert at cursor) with a specific heading
 * level. Accepts levels 1-6. Strips any existing heading prefix first. */
export function setHeadingLevel(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const desired = `${"#".repeat(level)} `;
  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
    const line = view.state.doc.line(lineNo);
    // Strip any existing heading prefix (up to 6 #s + a space).
    const match = /^(#{1,6}\s+)/.exec(line.text);
    if (match) {
      changes.push({
        from: line.from,
        to: line.from + match[1].length,
        insert: desired,
      });
    } else {
      changes.push({ from: line.from, to: line.from, insert: desired });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

/** Insert a fenced code block at the cursor, with `lang` on the opening
 * fence. Selected text (if any) is preserved inside the fence. */
export function insertCodeBlock(view: EditorView, lang: string = ""): void {
  const selection = view.state.selection.main;
  const { from, to } = selection;
  const selected = view.state.sliceDoc(from, to);
  const line = view.state.doc.lineAt(from);
  const needsLeadingNewline = from !== line.from;
  const leading = needsLeadingNewline ? "\n" : "";
  const content = selected || "";
  const snippet = `${leading}\`\`\`${lang}\n${content}\n\`\`\`\n`;
  const cursorPos = from + leading.length + 3 + lang.length + 1;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: selected
      ? { anchor: cursorPos, head: cursorPos + content.length }
      : { anchor: cursorPos },
  });
  view.focus();
}

/** Insert a link tag. Uses selected text as label if any, placeholder URL. */
export function insertLink(view: EditorView): void {
  const selection = view.state.selection.main;
  const { from, to } = selection;
  const selected = view.state.sliceDoc(from, to);
  const label = selected || "text";
  const snippet = `[${label}](https://)`;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: {
      anchor: from + label.length + 3,
      head: from + label.length + 3 + "https://".length,
    },
  });
  view.focus();
}

/** Insert a horizontal divider on its own line. */
export function insertDivider(view: EditorView): void {
  const pos = view.state.selection.main.from;
  const line = view.state.doc.lineAt(pos);
  const leadingNewline = pos === line.from ? "" : "\n";
  const snippet = `${leadingNewline}\n---\n\n`;
  view.dispatch({
    changes: { from: pos, to: pos, insert: snippet },
    selection: { anchor: pos + snippet.length },
  });
  view.focus();
}

/** Insert an MDX Callout component block. */
export function insertCallout(
  view: EditorView,
  tone: "info" | "warning" | "danger" | "success" | "note" = "info",
): void {
  const pos = view.state.selection.main.from;
  const line = view.state.doc.lineAt(pos);
  const leading = pos === line.from ? "" : "\n";
  const snippet = `${leading}\n<Callout tone="${tone}">\n\n</Callout>\n\n`;
  const cursor = pos + leading.length + 1 + `<Callout tone="${tone}">`.length + 1;
  view.dispatch({
    changes: { from: pos, to: pos, insert: snippet },
    selection: { anchor: cursor },
  });
  view.focus();
}

/** Insert an MDX Toggle component block. */
export function insertToggle(view: EditorView): void {
  const pos = view.state.selection.main.from;
  const line = view.state.doc.lineAt(pos);
  const leading = pos === line.from ? "" : "\n";
  const snippet = `${leading}\n<Toggle title="Click to expand">\n\n</Toggle>\n\n`;
  const cursor = pos + leading.length + 1 + `<Toggle title="Click to expand">`.length + 1;
  view.dispatch({
    changes: { from: pos, to: pos, insert: snippet },
    selection: { anchor: cursor },
  });
  view.focus();
}

/** Insert a KaTeX math block ($$ fences). */
export function insertMathBlock(view: EditorView): void {
  const pos = view.state.selection.main.from;
  const line = view.state.doc.lineAt(pos);
  const leading = pos === line.from ? "" : "\n";
  const snippet = `${leading}\n$$\n\n$$\n\n`;
  const cursor = pos + leading.length + 1 + 3;
  view.dispatch({
    changes: { from: pos, to: pos, insert: snippet },
    selection: { anchor: cursor },
  });
  view.focus();
}

/** Delete the typed `/` that triggered slash mode, then run a command.
 * Used from the slash-menu completion so the `/` doesn't stay in the doc. */
export function removeSlashThen(
  view: EditorView,
  run: (view: EditorView) => void,
): void {
  const pos = view.state.selection.main.from;
  if (pos > 0 && view.state.sliceDoc(pos - 1, pos) === "/") {
    view.dispatch({ changes: { from: pos - 1, to: pos, insert: "" } });
  }
  run(view);
}

export type SlashCommand = {
  id: string;
  label: string;
  detail?: string;
  run: (view: EditorView) => void;
};

/** Canonical set of slash commands exposed in the editor. Ordered by expected
 * frequency of use; the autocomplete extension sorts by its own scoring but
 * the array order is used when scores tie. */
export function slashCommands(): SlashCommand[] {
  return [
    { id: "h1", label: "Heading 1", detail: "# …", run: (v) => setHeadingLevel(v, 1) },
    { id: "h2", label: "Heading 2", detail: "## …", run: (v) => setHeadingLevel(v, 2) },
    { id: "h3", label: "Heading 3", detail: "### …", run: (v) => setHeadingLevel(v, 3) },
    {
      id: "bullet",
      label: "Bulleted list",
      detail: "- …",
      run: (v) => toggleLinePrefix(v, "- "),
    },
    {
      id: "numbered",
      label: "Numbered list",
      detail: "1. …",
      run: (v) => toggleLinePrefix(v, "1. "),
    },
    { id: "quote", label: "Quote", detail: "> …", run: (v) => toggleLinePrefix(v, "> ") },
    {
      id: "code",
      label: "Code block",
      detail: "``` lang …",
      run: (v) => insertCodeBlock(v, "ts"),
    },
    { id: "math", label: "Math block", detail: "$$ … $$", run: insertMathBlock },
    {
      id: "callout-info",
      label: "Callout (info)",
      detail: "<Callout tone=\"info\">",
      run: (v) => insertCallout(v, "info"),
    },
    {
      id: "callout-warn",
      label: "Callout (warning)",
      detail: "<Callout tone=\"warning\">",
      run: (v) => insertCallout(v, "warning"),
    },
    {
      id: "toggle",
      label: "Toggle",
      detail: "<Toggle title=\"…\">",
      run: insertToggle,
    },
    { id: "hr", label: "Divider", detail: "---", run: insertDivider },
  ];
}

// Re-export small utilities in case callers need bare line math.
export { lineEnd, lineStart };
