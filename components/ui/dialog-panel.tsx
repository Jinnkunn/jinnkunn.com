import type { ReactNode } from "react";

import { cn } from "./cn";

export function DialogPanel({
  title,
  description,
  children,
  actions,
  label,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  label?: string;
  className?: string;
}) {
  const ariaLabel = label || (typeof title === "string" ? title : undefined);

  return (
    <section
      className={cn("ds-dialog-panel", className || "")}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
    >
      <div className="ds-dialog-panel__header">
        <h3 className="ds-dialog-panel__title">{title}</h3>
        {description ? (
          <p className="ds-dialog-panel__description">{description}</p>
        ) : null}
      </div>
      {children ? <div className="ds-dialog-panel__body">{children}</div> : null}
      {actions ? <div className="ds-dialog-panel__actions">{actions}</div> : null}
    </section>
  );
}
