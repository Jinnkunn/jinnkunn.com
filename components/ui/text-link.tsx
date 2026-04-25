import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function TextLink({
  href,
  children,
  className,
  external = false,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children"> & {
  href: string;
  children: ReactNode;
  className?: string;
  external?: boolean;
}) {
  const classes = cn("ds-text-link", className || "");

  if (isInternalHref(href) && !external) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      className={classes}
      {...props}
      target={props.target || (external ? "_blank" : undefined)}
      rel={props.rel || (external ? "noreferrer" : undefined)}
    >
      {children}
    </a>
  );
}
