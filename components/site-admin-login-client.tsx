"use client";

import { useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";

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
          <StatusNotice tone="success">
            Signed in as <strong>{login || session?.user?.name || "GitHub user"}</strong>.
          </StatusNotice>
          <div className="page-state__actions">
            <Button href={safeNext}>
              Continue
            </Button>
            <Button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              variant="ghost"
            >
              Sign out
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" onClick={onSignIn} disabled={busy}>
          {busy ? "Redirecting..." : "Continue with GitHub"}
        </Button>
      )}
    </div>
  );
}
