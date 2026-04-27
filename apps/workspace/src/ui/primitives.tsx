import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function joinClassNames(
  ...items: Array<string | false | null | undefined>
): string {
  return items.filter(Boolean).join(" ");
}

export interface WorkspaceIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  tone?: "default" | "danger" | "accent";
}

export function WorkspaceIconButton({
  className,
  tone = "default",
  type = "button",
  ...props
}: WorkspaceIconButtonProps) {
  return (
    <button
      className={joinClassNames(
        "workspace-icon-button",
        tone !== "default" && `workspace-icon-button--${tone}`,
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export interface WorkspaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function WorkspaceToolbar({
  className,
  label = "Actions",
  role = "toolbar",
  ...props
}: WorkspaceToolbarProps) {
  return (
    <div
      aria-label={label}
      className={joinClassNames("workspace-toolbar", className)}
      role={role}
      {...props}
    />
  );
}

export interface WorkspacePopoverProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const WorkspacePopover = forwardRef<HTMLDivElement, WorkspacePopoverProps>(
  function WorkspacePopover({ className, children, ...props }, ref) {
    return (
      <div
        className={joinClassNames("workspace-popover", className)}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export interface WorkspaceFormRowProps extends HTMLAttributes<HTMLLabelElement> {
  label: string;
  hint?: ReactNode;
}

export function WorkspaceFormRow({
  className,
  children,
  hint,
  label,
  ...props
}: WorkspaceFormRowProps) {
  return (
    <label className={joinClassNames("workspace-form-row", className)} {...props}>
      <span className="workspace-form-row__label">{label}</span>
      {children}
      {hint ? <span className="workspace-form-row__hint">{hint}</span> : null}
    </label>
  );
}

export interface WorkspaceTextFieldProps
  extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceTextField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: WorkspaceTextFieldProps) {
  return (
    <WorkspaceFormRow hint={hint} label={label} className={wrapperClassName}>
      <input className={joinClassNames("ds-input", className)} {...props} />
    </WorkspaceFormRow>
  );
}

export interface WorkspaceTextareaFieldProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function WorkspaceTextareaField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: WorkspaceTextareaFieldProps) {
  return (
    <WorkspaceFormRow hint={hint} label={label} className={wrapperClassName}>
      <textarea className={joinClassNames("ds-input", className)} {...props} />
    </WorkspaceFormRow>
  );
}

export interface WorkspaceStatusBannerProps
  extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "muted" | "success" | "warn" | "error";
}

export function WorkspaceStatusBanner({
  className,
  role = "status",
  tone = "default",
  ...props
}: WorkspaceStatusBannerProps) {
  return (
    <div
      aria-live={role === "status" ? "polite" : undefined}
      className={joinClassNames(
        "workspace-status-banner",
        `workspace-status-banner--${tone}`,
        className,
      )}
      role={role}
      {...props}
    />
  );
}

export interface WorkspaceSidebarRowProps extends HTMLAttributes<HTMLDivElement> {
  depth?: number;
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
}

export function WorkspaceSidebarRow({
  className,
  depth,
  dragging,
  dragOver,
  selected,
  style,
  ...props
}: WorkspaceSidebarRowProps) {
  const rowStyle =
    depth === undefined
      ? style
      : ({ ...style, ["--sidebar-depth" as string]: depth } as CSSProperties);
  return (
    <div
      className={joinClassNames("workspace-sidebar-row", className)}
      data-dragging={dragging ? "true" : undefined}
      data-drag-over={dragOver ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      style={rowStyle}
      {...props}
    />
  );
}
