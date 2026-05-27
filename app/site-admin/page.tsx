import type { Metadata } from "next";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  getSiteAdminSessionIdentity,
  isAllowedAdminSessionIdentity,
} from "@/lib/site-admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Admin",
  description: "Authenticated Site Admin gateway",
  robots: { index: false, follow: false },
};

async function readAuthorizedIdentity() {
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const req = {
    cookies: { getAll: () => requestCookies.getAll() },
    headers: new Headers({ cookie: requestHeaders.get("cookie") || "" }),
  } as unknown as NextRequest;
  const identity = await getSiteAdminSessionIdentity(req);
  return isAllowedAdminSessionIdentity(identity) ? identity : null;
}

export default async function SiteAdminGatewayPage() {
  const identity = await readAuthorizedIdentity();
  if (!identity) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/site-admin")}`);
  }

  const actor = identity.email || identity.login || identity.actor;

  return (
    <SpecialStatePage
      badge="Site Admin"
      title="Authenticated"
      description="The browser gateway is signed in. Use the desktop or iOS app for the full Site Admin workspace; API access from this session is ready."
      actions={
        <>
          <Button href="/api/site-admin/status" variant="subtle">
            Open API status
          </Button>
          <Button href="/" variant="ghost">
            Public site
          </Button>
        </>
      }
    >
      <StatusNotice tone="success">Signed in as {actor}.</StatusNotice>
    </SpecialStatePage>
  );
}
