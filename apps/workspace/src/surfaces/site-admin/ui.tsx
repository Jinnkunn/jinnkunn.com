import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

function joinClassNames(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(" ");
}

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
  return (
    <div
      aria-label={label}
      className={joinClassNames("flex gap-2 flex-wrap", className)}
      role={role}
      {...props}
    />
  );
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
    <label className={joinClassNames("flex flex-col gap-1 text-[12.5px]", wrapperClassName)}>
      <span className="text-text-muted">{label}</span>
      <input className={joinClassNames("ds-input", className)} {...props} />
      {hint ? <span className="text-[11.5px] text-text-muted">{hint}</span> : null}
    </label>
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
    <label className={joinClassNames("flex flex-col gap-1 text-[12.5px]", wrapperClassName)}>
      <span className="text-text-muted">{label}</span>
      <textarea className={joinClassNames("ds-input", className)} {...props} />
      {hint ? <span className="text-[11.5px] text-text-muted">{hint}</span> : null}
    </label>
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
      ? "text-[color:var(--color-danger)]"
      : tone === "muted"
        ? "text-text-muted"
        : "text-text-primary";
  return (
    <p
      aria-live={role === "status" ? "polite" : undefined}
      className={joinClassNames("m-0 text-[12px]", toneClass, className)}
      role={role}
      {...props}
    />
  );
}
