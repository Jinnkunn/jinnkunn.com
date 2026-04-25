import type { ReactNode } from "react";

import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("ds-empty-state", className || "")} aria-live="polite">
      {icon ? (
        <div className="ds-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="ds-empty-state__copy">
        <h3 className="ds-empty-state__title">{title}</h3>
        {description ? (
          <p className="ds-empty-state__description">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="ds-empty-state__actions">{actions}</div> : null}
    </section>
  );
}
