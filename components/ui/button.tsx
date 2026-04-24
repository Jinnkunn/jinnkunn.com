import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import {
  type ButtonSurface,
  BUTTON_DEFAULTS,
  type DesignDensity,
  type DesignSize,
  type DesignTone,
  type DesignVariant,
} from "@/lib/design-system/primitives";
import { cn } from "./cn";

type ButtonBaseProps = {
  children: ReactNode;
  className?: string;
  variant?: DesignVariant;
  tone?: DesignTone;
  size?: DesignSize;
  density?: DesignDensity;
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
  input: Pick<ButtonBaseProps, "className" | "variant" | "tone" | "size" | "density" | "surface">,
) {
  return cn(
    "ds-button",
    `ds-button--variant-${input.variant}`,
    `ds-button--tone-${input.tone}`,
    `ds-button--size-${input.size}`,
    `ds-button--density-${input.density}`,
    `ds-button--surface-${input.surface}`,
    input.className || "",
  );
}

export function Button(props: ButtonProps) {
  const {
    className,
    variant = BUTTON_DEFAULTS.variant,
    tone = BUTTON_DEFAULTS.tone,
    size = BUTTON_DEFAULTS.size,
    density = BUTTON_DEFAULTS.density,
    surface = BUTTON_DEFAULTS.surface,
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
