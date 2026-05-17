export type EditorBlockType =
  | "paragraph"
  | "heading"
  | "quote"
  | "divider"
  | "todo"
  | "bulleted-list"
  | "numbered-list";

export type EditorTextMark = "bold" | "italic" | "code" | "underline";

export type EditorTextSpan = {
  text: string;
  marks?: EditorTextMark[];
};

export type EditorBlock = {
  id: string;
  type: EditorBlockType;
  text: EditorTextSpan[];
  level?: 1 | 2 | 3;
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
  | "numbered-list";

export type EditorCommand = {
  name: EditorCommandName;
  label: string;
  description: string;
  blockType: EditorBlockType;
  level?: 1 | 2 | 3;
};
