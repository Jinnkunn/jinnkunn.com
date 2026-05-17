export type EditorBlockType =
  | "paragraph"
  | "heading"
  | "quote"
  | "divider"
  | "todo"
  | "bulleted-list"
  | "numbered-list"
  | "code-block"
  | "callout"
  | "image"
  | "toggle"
  | "table"
  | "bookmark"
  | "embed"
  | "file"
  | "page-link"
  | "raw";

export type EditorTextMarkType =
  | "bold"
  | "italic"
  | "code"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "link"
  | "icon-link"
  | "text-color"
  | "background-color";

export type EditorTextMarkAttrs = Record<string, string>;

export type EditorTextMark = {
  attrs?: EditorTextMarkAttrs;
  type: EditorTextMarkType;
};

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
  attrs?: Record<string, unknown>;
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
  | "insert-fragment"
  | "update-text"
  | "split-block"
  | "merge-block"
  | "delete-block"
  | "move-block"
  | "set-block-indent"
  | "toggle-text-mark"
  | "set-text-mark"
  | "unset-text-mark"
  | "toggle-todo"
  | "set-block-type"
  | "set-block-attrs"
  | "markdown-shortcut"
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
  | "callout"
  | "image"
  | "toggle"
  | "table"
  | "bookmark"
  | "embed"
  | "file"
  | "page-link"
  | "raw";

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
  mark: EditorTextMarkType;
  label: string;
  description: string;
  kind: "toggle" | "link" | "icon-link" | "color";
  shortcut: string;
  tag: string;
  values?: string[];
};

export type EditorAttrValueType = "string" | "url" | "boolean" | "number" | "select" | "color";

export type EditorAttrSpec = {
  name: string;
  label: string;
  valueType: EditorAttrValueType;
  defaultValue?: string | number | boolean;
  description?: string;
  placeholder?: string;
  required?: boolean;
  values?: string[];
};

export type EditorExtensionGroup = "basic" | "format" | "media" | "embed" | "navigation" | "advanced";

export type EditorBlockRenderKind = "text" | "structured" | "void" | "container";

export type EditorBlockExtensionSpec = EditorBlockSpec & {
  attrsSchema?: EditorAttrSpec[];
  group: EditorExtensionGroup;
  renderKind: EditorBlockRenderKind;
  slashMenu: boolean;
};

export type EditorTextMarkExtensionSpec = EditorTextMarkSpec & {
  attrsSchema?: EditorAttrSpec[];
  group: EditorExtensionGroup;
  toolbar: boolean;
};

export type EditorExtensionManifest = {
  id: string;
  label: string;
  version: string;
  blocks: EditorBlockExtensionSpec[];
  textMarks: EditorTextMarkExtensionSpec[];
};
