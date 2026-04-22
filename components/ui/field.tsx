import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { cn } from "./cn";

export function Field({
  className,
  mono = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
}) {
  return <input {...props} className={cn("ds-field", mono ? "ds-field--mono" : "", className || "")} />;
}

export function Textarea({
  className,
  mono = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
}) {
  return (
    <textarea
      {...props}
      className={cn("ds-textarea", mono ? "ds-textarea--mono" : "", className || "")}
    />
  );
}

export function CheckboxRow({
  className,
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  children: React.ReactNode;
}) {
  return (
    <label className={cn("ds-checkbox-row", className || "")}>
      <input {...props} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}

