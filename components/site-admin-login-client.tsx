"use client";

import { useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

function normalizeNextPath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "/site-admin";
  if (!raw.startsWith("/")) return "/site-admin";
  if (raw.startsWith("//")) return "/site-admin";
  return raw;
}

export default function SiteAdminLoginClient({ nextPath }: { nextPath: string }) {
  const { data: session, status } = useSession();
  const [busy, setBusy] = useState(false);

  const safeNext = useMemo(() => normalizeNextPath(nextPath), [nextPath]);
  const login = (session?.user as { login?: string } | undefined)?.login || "";

  const onSignIn = async () => {
    setBusy(true);
    try {
      await signIn("github", { callbackUrl: safeNext });
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    try {
      await signOut({ callbackUrl: "/site-admin/login" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-state-auth">
      {status === "authenticated" ? (
        <>
          <p className="page-state__notice page-state__notice--ok">
            Signed in as <strong>{login || session?.user?.name || "GitHub user"}</strong>.
          </p>
          <div className="page-state__actions">
            <a
              href={safeNext}
              className="page-404__btn page-404__btn--primary"
            >
              Continue
            </a>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              className="page-404__btn page-404__btn--ghost"
            >
              Sign out
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="page-404__btn page-404__btn--primary"
        >
          {busy ? "Redirecting..." : "Continue with GitHub"}
        </button>
      )}
    </div>
  );
}
