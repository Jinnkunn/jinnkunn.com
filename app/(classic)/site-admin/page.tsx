import type { Metadata } from "next";
import Link from "next/link";
import SiteAdminDeployClient from "@/components/site-admin-deploy-client";

export const metadata: Metadata = {
  title: "Site Admin",
  description: "Admin dashboard",
};

export const dynamic = "force-dynamic";

export default async function SiteAdminHome() {
  return (
    <main id="page-site-admin" className="super-content page__site-admin parent-page__index">
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Site Admin</h1>
          </div>
        </div>
      </div>

      <article id="block-site-admin" className="notion-root max-width has-footer">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section>
            <h2 className="notion-heading notion-semantic-string">Deploy</h2>
            <p className="notion-text notion-text__content notion-semantic-string">
              Triggers a Vercel deploy (which will re-sync content from Notion during build).
            </p>
            <SiteAdminDeployClient />
          </section>

          <section>
            <h2 className="notion-heading notion-semantic-string">Tools</h2>
            <div className="notion-text notion-text__content notion-semantic-string">
              <ul>
                <li>
                  <Link href="/site-admin/config" className="notion-link link">
                    Config
                  </Link>{" "}
                  (site settings + navigation)
                </li>
                <li>
                  <Link href="/site-admin/routes" className="notion-link link">
                    Routes
                  </Link>{" "}
                  (inspect discovered routes)
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="notion-heading notion-semantic-string">Account</h2>
            <p className="notion-text notion-text__content notion-semantic-string">
              <Link href="/api/auth/signout" className="notion-link link">
                Sign out
              </Link>
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
