import type { HTMLAttributes, ReactNode } from "react";

import {
  type ContainerSurface,
  CONTAINER_DEFAULTS,
} from "@/lib/design-system/primitives";
import { cn } from "./cn";

export function Card({
  children,
  className,
  surface = CONTAINER_DEFAULTS.surface,
  ...props
}: {
  children: ReactNode;
  className?: string;
  surface?: ContainerSurface;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn("ds-card", `ds-card--surface-${surface}`, className || "")}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  className,
  surface = CONTAINER_DEFAULTS.surface,
  ...props
}: {
  children: ReactNode;
  className?: string;
  surface?: ContainerSurface;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={cn("ds-panel", `ds-panel--surface-${surface}`, className || "")}
    >
      {children}
    </section>
  );
}
