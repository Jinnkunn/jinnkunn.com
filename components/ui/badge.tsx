import type { ReactNode } from "react";

import { cn } from "./cn";

type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info" | "accent";
type BadgeVariant = "soft" | "outline";

export function Badge({
  children,
  className,
  tone = "neutral",
  variant = "soft",
  title,
}: {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "ds-badge",
        `ds-badge--tone-${tone}`,
        `ds-badge--variant-${variant}`,
        className || "",
      )}
    >
      {children}
    </span>
  );
}

