import { type ReactNode } from "react";

import type { MarkdownEditorApi } from "./MarkdownEditor";

interface ToolbarProps {
  getApi: () => MarkdownEditorApi | null;
}

type ToolbarAction = {
  id: string;
  label: ReactNode;
  title: string;
  onClick: (api: MarkdownEditorApi) => void;
};

function section(actions: ToolbarAction[]): ToolbarAction[] {
  return actions;
}

const HEADING_ACTIONS: ToolbarAction[] = section([
  {
    id: "h1",
    label: <strong style={{ fontSize: 13 }}>H1</strong>,
    title: "Heading 1 (⌘1)",
    onClick: (api) => api.setHeadingLevel(1),
  },
  {
    id: "h2",
    label: <strong style={{ fontSize: 12 }}>H2</strong>,
    title: "Heading 2 (⌘2)",
    onClick: (api) => api.setHeadingLevel(2),
  },
  {
    id: "h3",
    label: <strong style={{ fontSize: 11 }}>H3</strong>,
    title: "Heading 3 (⌘3)",
    onClick: (api) => api.setHeadingLevel(3),
  },
]);

const FORMAT_ACTIONS: ToolbarAction[] = section([
  {
    id: "bold",
    label: <strong>B</strong>,
    title: "Bold (⌘B)",
    onClick: (api) => api.wrapSelection("**"),
  },
  {
    id: "italic",
    label: <em>I</em>,
    title: "Italic (⌘I)",
    onClick: (api) => api.wrapSelection("*"),
  },
  {
    id: "code",
    label: <code>{"<>"}</code>,
    title: "Inline code (⌘`)",
    onClick: (api) => api.wrapSelection("`"),
  },
  {
    id: "strike",
    label: <s>S</s>,
    title: "Strikethrough",
    onClick: (api) => api.wrapSelection("~~"),
  },
]);

const BLOCK_ACTIONS: ToolbarAction[] = section([
  {
    id: "bullet",
    label: "• List",
    title: "Bulleted list (⌘⇧8)",
    onClick: (api) => api.toggleLinePrefix("- "),
  },
  {
    id: "numbered",
    label: "1. List",
    title: "Numbered list",
    onClick: (api) => api.toggleLinePrefix("1. "),
  },
  {
    id: "quote",
    label: "❝ Quote",
    title: "Quote (⌘⇧.)",
    onClick: (api) => api.toggleLinePrefix("> "),
  },
  {
    id: "codeblock",
    label: "{ }",
    title: "Code block (⌘⇧K)",
    onClick: (api) => api.insertCodeBlock("ts"),
  },
  {
    id: "hr",
    label: "—",
    title: "Horizontal rule",
    onClick: (api) => api.insertDivider(),
  },
  {
    id: "link",
    label: "🔗 Link",
    title: "Link (⌘K)",
    onClick: (api) => api.insertLink(),
  },
]);

const GROUPS: ToolbarAction[][] = [HEADING_ACTIONS, FORMAT_ACTIONS, BLOCK_ACTIONS];

export function MarkdownEditorToolbar({ getApi }: ToolbarProps) {
  const run = (action: ToolbarAction) => () => {
    const api = getApi();
    if (!api) return;
    action.onClick(api);
  };

  return (
    <div className="mdx-toolbar" role="toolbar" aria-label="Markdown formatting">
      {GROUPS.map((group, index) => (
        <div key={index} className="mdx-toolbar__group">
          {group.map((action) => (
            <button
              key={action.id}
              type="button"
              className="mdx-toolbar__btn"
              title={action.title}
              onMouseDown={(event) => {
                // Prevent the editor from losing focus so selection state is preserved.
                event.preventDefault();
              }}
              onClick={run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ))}
      <div className="mdx-toolbar__hint">Type <kbd>/</kbd> for block menu</div>
    </div>
  );
}
