import type { Metadata } from "next";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  getSiteAdminSessionIdentity,
  isAllowedAdminSessionIdentity,
} from "@/lib/site-admin-auth";
import type { SiteAdminMobileSummary } from "@/lib/site-admin/mobile-summary";
import { getSiteAdminMobileSummary } from "@/lib/server/site-admin-mobile-service";
import { SiteAdminWebConsole } from "./site-admin-web-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Admin",
  description: "Site Admin dashboard",
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

async function readSummary(): Promise<
  | { ok: true; summary: SiteAdminMobileSummary }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, summary: await getSiteAdminMobileSummary() };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

export default async function SiteAdminGatewayPage() {
  const identity = await readAuthorizedIdentity();
  if (!identity) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/site-admin")}`);
  }

  const actor = identity.email || identity.login || identity.actor;
  const summaryResult = await readSummary();

  return (
    <SiteAdminWebConsole
      actor={actor}
      initialSummary={summaryResult.ok ? summaryResult.summary : null}
      initialSummaryError={summaryResult.ok ? "" : summaryResult.error}
    />
  );
}
