import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import {
  WorkspaceTextField,
  WorkspaceTextareaField,
  WorkspaceToolbar,
  joinClassNames,
} from "../../ui/primitives";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
}

export function Button({
  className,
  tone = "secondary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={joinClassNames("btn", `btn--${tone}`, className)}
      type={type}
      {...props}
    />
  );
}

export interface IconButtonProps extends ButtonProps {
  "aria-label": string;
}

export function IconButton(props: IconButtonProps) {
  return <Button {...props} />;
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <section className={joinClassNames("surface-card", className)} {...props}>
      {children}
    </section>
  );
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function Toolbar({
  className,
  label = "Actions",
  role = "toolbar",
  ...props
}: ToolbarProps) {
  return <WorkspaceToolbar className={className} label={label} role={role} {...props} />;
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function Field({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: FieldProps) {
  return (
    <WorkspaceTextField
      className={className}
      hint={hint}
      label={label}
      wrapperClassName={wrapperClassName}
      {...props}
    />
  );
}

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  wrapperClassName?: string;
}

export function TextareaField({
  className,
  hint,
  label,
  wrapperClassName,
  ...props
}: TextareaFieldProps) {
  return (
    <WorkspaceTextareaField
      className={className}
      hint={hint}
      label={label}
      wrapperClassName={wrapperClassName}
      {...props}
    />
  );
}

export interface StatusNoticeProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: "error" | "muted" | "default";
}

export function StatusNotice({
  className,
  role = "status",
  tone = "default",
  ...props
}: StatusNoticeProps) {
  const toneClass =
    tone === "error"
      ? "workspace-status-banner--error"
      : tone === "muted"
        ? "workspace-status-banner--muted"
        : "workspace-status-banner--default";
  return (
    <p
      aria-live={role === "status" ? "polite" : undefined}
      className={joinClassNames("workspace-status-banner", toneClass, className)}
      role={role}
      {...props}
    />
  );
}
