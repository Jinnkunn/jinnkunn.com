import type { Metadata } from "next";
import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";

export const metadata: Metadata = {
  title: "Protected",
  description: "Password required",
};

export const dynamic = "force-dynamic";

function normalizeNextPath(p: string | null): string {
  const raw = String(p || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  // Basic hardening: keep it a path, not a full URL.
  if (raw.startsWith("//")) return "/";
  return raw;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; rid?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const nextPath = normalizeNextPath(sp.next ?? null);
  const rid = String(sp.rid ?? "").trim();
  const error = String(sp.error ?? "").trim();

  return (
    <SpecialStatePage
      tone="locked"
      badge="Protected"
      title="Password required"
      description="This page is access-restricted. Enter the password to continue."
      actions={
        <>
          <Button type="submit" form="state-auth-form">
            Unlock
          </Button>
          <Button href="/" variant="ghost">
            Home
          </Button>
        </>
      }
    >
      {error ? (
        <StatusNotice tone="danger">
          Incorrect password. Please try again.
        </StatusNotice>
      ) : null}

      <form id="state-auth-form" method="post" action="/api/site-auth" className="page-state-form">
        <input type="hidden" name="next" value={nextPath} />
        <input type="hidden" name="rid" value={rid} />
        <label htmlFor="password" className="page-state-form__label">
          Password
        </label>
        <Field
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          size="sm"
          density="compact"
          mono
          placeholder="Enter password"
        />
      </form>
    </SpecialStatePage>
  );
}
