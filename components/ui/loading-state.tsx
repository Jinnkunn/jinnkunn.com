import { cn } from "./cn";

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("ds-loading-state", className || "")} role="status" aria-live="polite">
      <span className="ds-loading-state__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
