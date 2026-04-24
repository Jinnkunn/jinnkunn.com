"use client";

import type { ReactNode } from "react";

import { IconButton as PrimitiveIconButton } from "@/components/ui/icon-button";
import { cn } from "./utils";

export function IconButton({
  children,
  className,
  label,
  onClick,
  disabled,
  href,
  title,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  title?: string;
}) {
  const props = {
    className: cn("routes-tree__icon-btn", className || ""),
    label,
    title: title || label,
    variant: "subtle" as const,
    size: "sm" as const,
    active: className?.includes("is-active"),
    children,
  };

  if (href) {
    return (
      <PrimitiveIconButton
        {...props}
        href={href}
        external
      >
        {children}
      </PrimitiveIconButton>
    );
  }

  return (
    <PrimitiveIconButton
      {...props}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </PrimitiveIconButton>
  );
}
