import type { ReactNode } from "react";

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
  variant = "subtle",
  size = "sm",
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      className={cn("ds-icon-button", active ? "is-active" : "", className || "")}
      variant={variant}
      size={size}
      aria-label={label}
      title={title || label}
    >
      {children}
    </Button>
  );
}
