import type { ReactNode } from "react";

import {
  type DesignDensity,
  type DesignSize,
  type DesignTone,
  STATUS_NOTICE_DEFAULTS,
} from "@/lib/design-system/primitives";
import { cn } from "./cn";

export function StatusNotice({
  children,
  className,
  tone = STATUS_NOTICE_DEFAULTS.tone,
  size = STATUS_NOTICE_DEFAULTS.size,
  density = STATUS_NOTICE_DEFAULTS.density,
}: {
  children: ReactNode;
  className?: string;
  tone?: DesignTone;
  size?: DesignSize;
  density?: DesignDensity;
}) {
  return (
    <p
      className={cn(
        "ds-status-notice",
        `ds-status-notice--tone-${tone}`,
        `ds-status-notice--size-${size}`,
        `ds-status-notice--density-${density}`,
        className || "",
      )}
    >
      {children}
    </p>
  );
}
