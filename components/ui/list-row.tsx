import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "./cn";

function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function RowContent({
  leading,
  title,
  description,
  meta,
  trailing,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      {leading ? (
        <span className="ds-list-row__leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="ds-list-row__main">
        <span className="ds-list-row__title">{title}</span>
        {description ? (
          <span className="ds-list-row__description">{description}</span>
        ) : null}
      </span>
      {meta ? <span className="ds-list-row__meta">{meta}</span> : null}
      {trailing ? <span className="ds-list-row__trailing">{trailing}</span> : null}
    </>
  );
}

export function ListRow({
  title,
  description,
  meta,
  leading,
  trailing,
  href,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  className?: string;
}) {
  const classes = cn("ds-list-row", href ? "ds-list-row--interactive" : "", className || "");
  const content = (
    <RowContent
      leading={leading}
      title={title}
      description={description}
      meta={meta}
      trailing={trailing}
    />
  );

  if (href && isInternalHref(href)) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={classes} rel="noreferrer" target="_blank">
        {content}
      </a>
    );
  }

  return <div className={classes}>{content}</div>;
}
