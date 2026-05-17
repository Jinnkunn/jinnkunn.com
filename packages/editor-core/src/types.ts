export type EditorBlockType =
  | "paragraph"
  | "heading"
  | "quote"
  | "divider"
  | "todo"
  | "bulleted-list"
  | "numbered-list"
  | "code-block"
  | "callout";

export type EditorTextMark = "bold" | "italic" | "code" | "underline" | "strikethrough" | "highlight";

export type EditorTextSpan = {
  text: string;
  marks?: EditorTextMark[];
};

export type EditorBlock = {
  id: string;
  type: EditorBlockType;
  text: EditorTextSpan[];
  level?: 1 | 2 | 3;
  indent?: number;
  checked?: boolean;
  children?: EditorBlock[];
};

export type EditorDocument = {
  version: 1;
  title: string;
  blocks: EditorBlock[];
};

export type EditorCursorPosition = {
  blockId: string;
  offset: number;
};

export type EditorSelection = {
  anchor: EditorCursorPosition;
  focus: EditorCursorPosition;
};

export type EditorTransactionKind =
  | "insert-block"
  | "update-text"
  | "split-block"
  | "merge-block"
  | "delete-block"
  | "move-block"
  | "set-block-indent"
  | "toggle-text-mark"
  | "toggle-todo"
  | "set-block-type"
  | "normalize";

export type EditorTransaction = {
  id: string;
  kind: EditorTransactionKind;
  before: EditorDocument;
  after: EditorDocument;
  selection?: EditorSelection;
  createdAt: string;
};

export type EditorCommandName =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "quote"
  | "divider"
  | "todo"
  | "bulleted-list"
  | "numbered-list"
  | "code-block"
  | "callout";

export type EditorCommand = {
  name: EditorCommandName;
  label: string;
  description: string;
  blockType: EditorBlockType;
  level?: 1 | 2 | 3;
  icon?: string;
  placeholder?: string;
  markdownShortcut?: string;
};

export type EditorBlockSpec = EditorCommand;

export type EditorTextMarkSpec = {
  mark: EditorTextMark;
  label: string;
  description: string;
  shortcut: string;
  tag: string;
};
