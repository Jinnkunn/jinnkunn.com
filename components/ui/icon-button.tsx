import type { ReactNode } from "react";

import { ICON_BUTTON_DEFAULTS } from "@/lib/design-system/primitives";
import { cn } from "./cn";
import { Button, type ButtonProps } from "./button";

type IconButtonSharedProps = {
  children: ReactNode;
  label: string;
  title?: string;
  active?: boolean;
};

type LinkIconButtonProps = Omit<Extract<ButtonProps, { href: string }>, "children"> &
  IconButtonSharedProps;

type NativeIconButtonProps = Omit<Extract<ButtonProps, { href?: undefined }>, "children"> &
  IconButtonSharedProps;

type IconButtonProps = LinkIconButtonProps | NativeIconButtonProps;

export function IconButton({
  children,
  className,
  label,
  title,
  active = false,
  variant = ICON_BUTTON_DEFAULTS.variant,
  tone = ICON_BUTTON_DEFAULTS.tone,
  size = ICON_BUTTON_DEFAULTS.size,
  density = ICON_BUTTON_DEFAULTS.density,
  surface = ICON_BUTTON_DEFAULTS.surface,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      className={cn("ds-icon-button", active ? "is-active" : "", className || "")}
      variant={variant}
      tone={tone}
      size={size}
      density={density}
      surface={surface}
      aria-label={label}
      title={title || label}
    >
      {children}
    </Button>
  );
}
