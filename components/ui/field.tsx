import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

import {
  type DesignDensity,
  type DesignSize,
  FIELD_DEFAULTS,
} from "@/lib/design-system/primitives";
import { cn } from "./cn";

export function Field({
  className,
  mono = false,
  size = FIELD_DEFAULTS.size,
  density = FIELD_DEFAULTS.density,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  mono?: boolean;
  size?: DesignSize;
  density?: DesignDensity;
}) {
  return (
    <input
      {...props}
      className={cn(
        "ds-field",
        `ds-field--size-${size}`,
        `ds-field--density-${density}`,
        mono ? "ds-field--mono" : "",
        className || "",
      )}
    />
  );
}

export function Textarea({
  className,
  mono = false,
  size = FIELD_DEFAULTS.size,
  density = FIELD_DEFAULTS.density,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
  size?: DesignSize;
  density?: DesignDensity;
}) {
  return (
    <textarea
      {...props}
      className={cn(
        "ds-textarea",
        `ds-textarea--size-${size}`,
        `ds-textarea--density-${density}`,
        mono ? "ds-textarea--mono" : "",
        className || "",
      )}
    />
  );
}

export function CheckboxRow({
  className,
  children,
  size = FIELD_DEFAULTS.size,
  density = FIELD_DEFAULTS.density,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  children: ReactNode;
  size?: DesignSize;
  density?: DesignDensity;
}) {
  return (
    <label
      className={cn(
        "ds-checkbox-row",
        `ds-checkbox-row--size-${size}`,
        `ds-checkbox-row--density-${density}`,
        className || "",
      )}
    >
      <input {...props} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
