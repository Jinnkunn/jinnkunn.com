import type { ReactNode } from "react";

export interface BlockEditorCommand {
  description: string;
  // Optional grouping; when any command sets a group, BlockEditorCommandMenu
  // renders sectioned headers in input order. Commands without a group fall
  // into an "Other" section at the end.
  group?: string;
  // Short glyph (1–2 chars) shown to the left of each menu row. Pure unicode
  // — no SVG / image deps. Falls back to the first letter of the label when
  // omitted.
  icon?: string;
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

function renderCommandButton<TCommand extends BlockEditorCommand>(
  command: TCommand,
  onChoose: (command: TCommand) => void,
  active: boolean,
  onActive?: (command: TCommand) => void,
) {
  const icon = command.icon ?? command.label.charAt(0);
  return (
    <button
      type="button"
      role="menuitem"
      key={command.id}
      data-active={active ? "true" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActive?.(command)}
      onFocus={() => onActive?.(command)}
      onClick={() => onChoose(command)}
    >
      <span className="block-editor-command__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="block-editor-command__body">
        <strong>{command.label}</strong>
        <span>{command.description}</span>
      </span>
    </button>
  );
}

export function BlockEditorCommandMenu<TCommand extends BlockEditorCommand>({
  activeCommandId,
  ariaLabel = "Block shortcuts",
  className,
  commands,
  empty,
  onActiveCommandChange,
  onChoose,
}: {
  activeCommandId?: string;
  ariaLabel?: string;
  className: string;
  commands: TCommand[];
  empty?: ReactNode;
  onActiveCommandChange?: (command: TCommand) => void;
  onChoose: (command: TCommand) => void;
}) {
  if (commands.length === 0) {
    return (
      <div className={className} role="menu" aria-label={ariaLabel}>
        {empty}
      </div>
    );
  }
  // Preserve input order of groups; group label "" goes to the end as Other.
  const grouped = new Map<string, TCommand[]>();
  for (const command of commands) {
    const key = command.group ?? "";
    const bucket = grouped.get(key);
    if (bucket) bucket.push(command);
    else grouped.set(key, [command]);
  }
  const useGroups = Array.from(grouped.keys()).some((g) => g !== "");
  return (
    <div className={className} role="menu" aria-label={ariaLabel}>
      {useGroups
        ? Array.from(grouped.entries()).map(([group, items]) => (
            <div className="block-editor-command__group" key={group || "_other"}>
              {group ? (
                <div className="block-editor-command__group-label">{group}</div>
              ) : null}
              {items.map((command) =>
                renderCommandButton(
                  command,
                  onChoose,
                  command.id === activeCommandId,
                  onActiveCommandChange,
                ),
              )}
            </div>
          ))
        : commands.map((command) =>
            renderCommandButton(
              command,
              onChoose,
              command.id === activeCommandId,
              onActiveCommandChange,
            ),
          )}
    </div>
  );
}
