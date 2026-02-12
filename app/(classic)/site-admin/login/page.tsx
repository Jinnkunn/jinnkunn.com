import type { Metadata } from "next";
import Link from "next/link";
import { SpecialStatePage } from "@/components/special-state-page";
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
    <SpecialStatePage
      tone="locked"
      badge="Site Admin"
      title="Sign in required"
      description="This area is restricted to approved GitHub accounts."
      actions={
        <Link href="/" className="page-404__btn page-404__btn--ghost">
          Home
        </Link>
      }
    >
      <SiteAdminLoginClient nextPath={next} />
    </SpecialStatePage>
  );
}
