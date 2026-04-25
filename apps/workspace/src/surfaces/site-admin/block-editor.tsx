import type { ReactNode } from "react";

export interface BlockEditorCommand {
  description: string;
  id: string;
  keywords: string[];
  label: string;
}

interface BlockEditorCommandQueryOptions {
  requireSlash?: boolean;
}

export function normalizeBlockEditorCommandQuery(
  value: string,
  options: BlockEditorCommandQueryOptions = {},
) {
  const trimmed = value.trim().toLowerCase();
  if (options.requireSlash && !trimmed.startsWith("/")) return null;
  return trimmed.replace(/^\//, "").replace(/\s+/g, "");
}

export function getMatchingBlockEditorCommands<TCommand extends BlockEditorCommand>(
  value: string,
  commands: TCommand[],
  options: BlockEditorCommandQueryOptions = {},
) {
  const query = normalizeBlockEditorCommandQuery(value, options);
  if (query === null) return [];
  if (!query) return commands;
  return commands.filter((command) => {
    const label = normalizeBlockEditorCommandQuery(command.label);
    return (
      label?.includes(query) ||
      command.id.toLowerCase().includes(query) ||
      command.keywords.some((keyword) => keyword.includes(query))
    );
  });
}

export function BlockEditorCommandMenu<TCommand extends BlockEditorCommand>({
  ariaLabel = "Block shortcuts",
  className,
  commands,
  empty,
  onChoose,
}: {
  ariaLabel?: string;
  className: string;
  commands: TCommand[];
  empty?: ReactNode;
  onChoose: (command: TCommand) => void;
}) {
  return (
    <div className={className} role="menu" aria-label={ariaLabel}>
      {commands.length
        ? commands.map((command) => (
            <button
              type="button"
              role="menuitem"
              key={command.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(command)}
            >
              <strong>{command.label}</strong>
              <span>{command.description}</span>
            </button>
          ))
        : empty}
    </div>
  );
}
