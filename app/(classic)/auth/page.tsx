import type { Metadata } from "next";
import Link from "next/link";
import { SpecialStatePage } from "@/components/special-state-page";

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
          <button type="submit" form="state-auth-form" className="page-404__btn page-404__btn--primary">
            Unlock
          </button>
          <Link href="/" className="page-404__btn page-404__btn--ghost">
            Home
          </Link>
        </>
      }
    >
      {error ? (
        <p className="page-state__notice page-state__notice--error">
          Incorrect password. Please try again.
        </p>
      ) : null}

      <form id="state-auth-form" method="post" action="/api/site-auth" className="page-state-form">
        <input type="hidden" name="next" value={nextPath} />
        <input type="hidden" name="rid" value={rid} />
        <label htmlFor="password" className="page-state-form__label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="page-state-form__input page-state-form__input--mono"
          placeholder="Enter password"
        />
      </form>
    </SpecialStatePage>
  );
}
