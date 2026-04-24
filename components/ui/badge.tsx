import type { ReactNode } from "react";

import {
  type BadgeVariant,
  BADGE_DEFAULTS,
  type DesignDensity,
  type DesignSize,
  type DesignTone,
} from "@/lib/design-system/primitives";
import { cn } from "./cn";

export function Badge({
  children,
  className,
  tone = BADGE_DEFAULTS.tone,
  variant = BADGE_DEFAULTS.variant,
  size = BADGE_DEFAULTS.size,
  density = BADGE_DEFAULTS.density,
  title,
}: {
  children: ReactNode;
  className?: string;
  tone?: DesignTone;
  variant?: BadgeVariant;
  size?: DesignSize;
  density?: DesignDensity;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "ds-badge",
        `ds-badge--tone-${tone}`,
        `ds-badge--variant-${variant}`,
        `ds-badge--size-${size}`,
        `ds-badge--density-${density}`,
        className || "",
      )}
    >
      {children}
    </span>
  );
}
