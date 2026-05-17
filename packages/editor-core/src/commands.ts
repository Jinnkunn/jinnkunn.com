import type { EditorCommand } from "./types.ts";

export const EDITOR_COMMANDS: EditorCommand[] = [
  {
    name: "paragraph",
    label: "Text",
    description: "Plain paragraph text",
    blockType: "paragraph",
  },
  {
    name: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    blockType: "heading",
    level: 1,
  },
  {
    name: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    blockType: "heading",
    level: 2,
  },
  {
    name: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    blockType: "heading",
    level: 3,
  },
  {
    name: "quote",
    label: "Quote",
    description: "Quoted text block",
    blockType: "quote",
  },
  {
    name: "divider",
    label: "Divider",
    description: "Horizontal divider",
    blockType: "divider",
  },
  {
    name: "todo",
    label: "To-do",
    description: "Checkbox item",
    blockType: "todo",
  },
  {
    name: "bulleted-list",
    label: "Bullet list",
    description: "Bulleted list item",
    blockType: "bulleted-list",
  },
  {
    name: "numbered-list",
    label: "Numbered list",
    description: "Numbered list item",
    blockType: "numbered-list",
  },
];

export function findEditorCommand(query: string): EditorCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return EDITOR_COMMANDS;
  return EDITOR_COMMANDS.filter((command) => {
    return (
      command.label.toLowerCase().includes(needle) ||
      command.description.toLowerCase().includes(needle) ||
      command.name.includes(needle)
    );
  });
}
