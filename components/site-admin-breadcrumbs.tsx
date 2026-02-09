import Link from "next/link";
import { Fragment } from "react";

type Crumb = { href: string; label: string };

export default function SiteAdminBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return null;

  return (
    <div className="super-navbar__breadcrumbs" aria-label="Breadcrumb">
      <div className="notion-breadcrumb">
        {crumbs.map((c, idx) => (
          <Fragment key={`${c.href}:${idx}`}>
            <Link href={c.href} className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">{c.label}</div>
            </Link>
            {idx < crumbs.length - 1 ? (
              <span className="notion-breadcrumb__divider">/</span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
