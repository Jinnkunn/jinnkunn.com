import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

type ButtonVariant = "solid" | "ghost" | "subtle" | "nav";
type ButtonTone = "neutral" | "accent" | "success" | "danger" | "warning" | "info";
type ButtonSize = "sm" | "md";
type ButtonDensity = "compact" | "default";
type ButtonSurface = "default" | "inverse";

type ButtonBaseProps = {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  density?: ButtonDensity;
  surface?: ButtonSurface;
  href?: string;
  external?: boolean;
};

type LinkButtonProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href" | "children"> & {
    href: string;
  };

type NativeButtonProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

export type ButtonProps = LinkButtonProps | NativeButtonProps;

function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function buttonClassName(
  input: Pick<
    ButtonBaseProps,
    "className" | "variant" | "tone" | "size" | "density" | "surface"
  >,
) {
  return cn(
    "ds-button",
    `ds-button--variant-${input.variant || "solid"}`,
    `ds-button--tone-${input.tone || "neutral"}`,
    `ds-button--size-${input.size || "md"}`,
    `ds-button--density-${input.density || "default"}`,
    `ds-button--surface-${input.surface || "default"}`,
    input.className || "",
  );
}

export function Button(props: ButtonProps) {
  const {
    className,
    variant = "solid",
    tone = "neutral",
    size = "md",
    density = "default",
    surface = "default",
    href,
    children,
    ...rest
  } = props;

  const classes = buttonClassName({
    className,
    variant,
    tone,
    size,
    density,
    surface,
  });

  if (href) {
    if (isInternalHref(href) && !props.external) {
      const linkProps = rest as Omit<LinkButtonProps, keyof ButtonBaseProps>;
      return (
        <Link href={href} className={classes} {...linkProps}>
          {children}
        </Link>
      );
    }

    const linkProps = rest as Omit<LinkButtonProps, keyof ButtonBaseProps>;
    return (
      <a
        href={href}
        className={classes}
        {...linkProps}
        target={linkProps.target || (props.external ? "_blank" : undefined)}
        rel={linkProps.rel || (props.external ? "noreferrer" : undefined)}
      >
        {children}
      </a>
    );
  }

  const buttonProps = rest as Omit<NativeButtonProps, keyof ButtonBaseProps>;
  return (
    <button type={buttonProps.type || "button"} className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
