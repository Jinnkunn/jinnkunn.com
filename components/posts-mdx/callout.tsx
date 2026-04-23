import type { ReactNode } from "react";

export type CalloutTone = "info" | "warning" | "danger" | "success" | "note";

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className={`mdx-callout mdx-callout--${tone}`} role="note">
      {title && <p className="mdx-callout__title">{title}</p>}
      <div className="mdx-callout__body">{children}</div>
    </aside>
  );
}
