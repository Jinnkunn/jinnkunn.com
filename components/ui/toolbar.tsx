import type { ReactNode } from "react";

import { cn } from "./cn";

export function Toolbar({
  label,
  start,
  end,
  className,
}: {
  label: string;
  start?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ds-toolbar", className || "")} role="toolbar" aria-label={label}>
      <div className="ds-toolbar__group">{start}</div>
      <div className="ds-toolbar__group ds-toolbar__group--end">{end}</div>
    </div>
  );
}
