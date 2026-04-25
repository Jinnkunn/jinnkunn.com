import type { AnchorHTMLAttributes, ReactNode } from "react";

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function externalAnchorProps(href: string) {
  return isExternalHref(href)
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
}

export function ClassicLink({
  href,
  className = "notion-link link",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      {...externalAnchorProps(href)}
      {...props}
    >
      {children}
    </a>
  );
}
