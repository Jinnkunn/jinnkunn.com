import type { ReactNode } from "react";

// Render the same structural contract as the legacy Notion export. The global
// Notion behavior script owns the open/closed state for this markup, which keeps
// migrated Notion toggles and authored MDX toggles consistent.
export function Toggle({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  const stateClass = open ? "open" : "closed";
  return (
    <div className={`notion-toggle mdx-toggle ${stateClass}`}>
      <div className="notion-toggle__summary">
        <span className="notion-toggle__trigger">
          <span className="notion-toggle__trigger_icon">
            <span>‣</span>
          </span>
        </span>
        <span className="notion-semantic-string">
          <strong>{title}</strong>
        </span>
      </div>
      <div className="notion-toggle__content" hidden={!open} aria-hidden={open ? "false" : "true"}>
        {children}
      </div>
    </div>
  );
}
