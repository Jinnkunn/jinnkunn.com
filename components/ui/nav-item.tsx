import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "./cn";

export function NavItem({
  href,
  children,
  className,
  menuItem = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  menuItem?: boolean;
}) {
  return (
    <Link
      href={href}
      role={menuItem ? "menuitem" : undefined}
      className={cn("ds-nav-item", className || "")}
    >
      {children}
    </Link>
  );
}

