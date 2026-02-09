import type { Metadata } from "next";
import SiteAdminLoginClient from "@/components/site-admin-login-client";

export const metadata: Metadata = {
  title: "Site Admin Login",
  description: "Sign in to manage the site",
};

export const dynamic = "force-dynamic";

export default async function SiteAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = String(sp.next || "/site-admin").trim() || "/site-admin";

  return (
    <main id="page-site-admin-login" className="super-content page__site-admin-login parent-page__index">
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Site Admin</h1>
          </div>
        </div>
      </div>

      <article id="block-site-admin-login" className="notion-root max-width has-footer">
        <p className="notion-text notion-text__content notion-semantic-string">
          This area is restricted to approved GitHub accounts.
        </p>
        <SiteAdminLoginClient nextPath={next} />
      </article>
    </main>
  );
}

