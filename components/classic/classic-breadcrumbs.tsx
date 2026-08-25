import { Fragment } from "react";

export type ClassicBreadcrumb = {
  href: string;
  label: string;
};

export function ClassicBreadcrumbs({
  crumbs,
}: {
  crumbs: ClassicBreadcrumb[];
}) {
  if (crumbs.length === 0) return null;

  return (
    <div className="super-navbar__breadcrumbs" aria-label="Breadcrumb">
      <div className="notion-breadcrumb">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.href}:${index}`}>
            <a href={crumb.href} className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">
                {crumb.label}
              </div>
            </a>
            {index < crumbs.length - 1 ? (
              <span className="notion-breadcrumb__divider">/</span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
