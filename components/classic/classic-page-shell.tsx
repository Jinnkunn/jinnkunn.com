import type { ReactNode } from "react";

import {
  ClassicBreadcrumbs,
  type ClassicBreadcrumb,
} from "@/components/classic/classic-breadcrumbs";

export function ClassicPageShell({
  title,
  className,
  breadcrumbs,
  beforeHeader,
  children,
}: {
  title: ReactNode;
  className: string;
  breadcrumbs?: ClassicBreadcrumb[];
  beforeHeader?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className={className}>
      {beforeHeader}
      {breadcrumbs && <ClassicBreadcrumbs crumbs={breadcrumbs} />}
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">{children}</article>
    </main>
  );
}
