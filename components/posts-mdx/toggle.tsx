import type { ReactNode } from "react";

// Render as a native <details> element so it works without client JS and still
// inherits any existing Notion-toggle CSS tweaks. We intentionally use the same
// "notion-toggle" class family so styling stays consistent across old and new
// posts.
export function Toggle({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="notion-toggle mdx-toggle" open={open}>
      <summary className="notion-toggle__summary">
        <span className="notion-toggle__trigger">
          <span className="notion-toggle__trigger_icon">
            <span>‣</span>
          </span>
        </span>
        <span className="notion-semantic-string">
          <strong>{title}</strong>
        </span>
      </summary>
      <div className="notion-toggle__content">{children}</div>
    </details>
  );
}
