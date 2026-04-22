import type { ReactNode } from "react";

import { cn } from "./cn";

type Tone = "default" | "success" | "danger" | "warning" | "info";

export function StatusNotice({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return (
    <p className={cn("ds-status-notice", `ds-status-notice--tone-${tone}`, className || "")}>
      {children}
    </p>
  );
}

