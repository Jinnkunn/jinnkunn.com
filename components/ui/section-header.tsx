import type { ReactNode } from "react";

import { cn } from "./cn";

export function SectionHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ds-section-header", className || "")}>
      <div className="ds-section-header__copy">
        {eyebrow ? <div className="ds-section-header__eyebrow">{eyebrow}</div> : null}
        <h2 className="ds-section-header__title">{title}</h2>
        {description ? <p className="ds-section-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ds-section-header__actions">{actions}</div> : null}
    </div>
  );
}

