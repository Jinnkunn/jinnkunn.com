"use client";

import type { ReactNode } from "react";

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
  const cls = cn("routes-tree__icon-btn", className || "");
  if (href) {
    return (
      <a
        className={cls}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        title={title || label}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title || label}
    >
      {children}
    </button>
  );
}

