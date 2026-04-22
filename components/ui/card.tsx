import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

type Surface = "default" | "elevated" | "soft";

export function Card({
  children,
  className,
  surface = "default",
  ...props
}: {
  children: ReactNode;
  className?: string;
  surface?: Surface;
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
  surface = "default",
  ...props
}: {
  children: ReactNode;
  className?: string;
  surface?: Surface;
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
