import type { Metadata } from "next";
import { SpecialStatePage } from "@/components/special-state-page";
import SiteAdminLoginClient from "@/components/site-admin-login-client";
import { StatusNotice } from "@/components/ui/status-notice";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Site Admin Login",
  description: "Sign in to manage the site",
};

export const dynamic = "force-dynamic";

// Surfaces server env that NextAuth + GitHub OAuth need. When any of
// these are missing, `signIn("github")` silently no-ops in the browser,
// which is terrible to debug. We render an inline red banner so the
// failure mode is obvious at page load.
function missingAuthEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.GITHUB_ID?.trim()) missing.push("GITHUB_ID");
  if (!process.env.GITHUB_SECRET?.trim()) missing.push("GITHUB_SECRET");
  if (!process.env.NEXTAUTH_URL?.trim()) {
    missing.push("NEXTAUTH_URL");
  }
  const secret =
    process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!secret) missing.push("NEXTAUTH_SECRET");
  if (!process.env.SITE_ADMIN_GITHUB_USERS?.trim()) {
    missing.push("SITE_ADMIN_GITHUB_USERS");
  }
  return missing;
}

export default async function SiteAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = String(sp.next || "/site-admin").trim() || "/site-admin";
  const missing = missingAuthEnv();

  return (
    <SpecialStatePage
      tone="locked"
      badge="Site Admin"
      title="Sign in required"
      description="This area is restricted to approved GitHub accounts."
      actions={
        <Button href="/" variant="ghost">
          Home
        </Button>
      }
    >
      {missing.length > 0 && (
        <StatusNotice tone="danger">
          <strong>Auth not configured.</strong>{" "}
          Missing server env: <code>{missing.join(", ")}</code>. Clicking
          &ldquo;Continue with GitHub&rdquo; will silently fail until these are
          set. See{" "}
          <a
            href="https://github.com/settings/developers"
            className="notion-link"
            target="_blank"
            rel="noreferrer"
          >
            GitHub OAuth Apps
          </a>{" "}
          for client credentials; set <code>NEXTAUTH_URL</code> to the current
          origin (e.g. <code>http://localhost:3000</code> in dev).
        </StatusNotice>
      )}
      <SiteAdminLoginClient nextPath={next} />
    </SpecialStatePage>
  );
}
