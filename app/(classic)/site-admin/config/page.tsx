import type { Metadata } from "next";
import Link from "next/link";

import SiteAdminConfigClient from "@/components/site-admin-config-client";
import SiteAdminBreadcrumbs from "@/components/site-admin-breadcrumbs";

export const metadata: Metadata = {
  title: "Site Admin: Config",
  description: "Edit site settings + navigation",
};

export const dynamic = "force-dynamic";

export default function SiteAdminConfigPage() {
  return (
    <main className="super-content page__site-admin parent-page__index">
      <SiteAdminBreadcrumbs
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/site-admin", label: "Site Admin" },
          { href: "/site-admin/config", label: "Config" },
        ]}
      />
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Config</h1>
          </div>
        </div>
      </div>

      <article className="notion-root max-width has-footer">
        <p className="notion-text notion-text__content notion-semantic-string">
          <Link href="/site-admin" className="notion-link link">
            Back to Site Admin
          </Link>
        </p>
        <SiteAdminConfigClient />
      </article>
    </main>
  );
}
