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
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      {status === "authenticated" ? (
        <>
          <p className="notion-text notion-text__content notion-semantic-string">
            Signed in as <strong>{login || session?.user?.name || "GitHub user"}</strong>.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a
              href={safeNext}
              className="notion-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 40,
                padding: "0 14px",
                borderRadius: 10,
                border: "1px solid var(--color-border-default)",
                background: "var(--color-card-bg)",
                color: "var(--color-text-default)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Continue
            </a>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 10,
                border: "1px solid var(--color-border-default)",
                background: "var(--color-card-bg)",
                color: "var(--color-text-default)",
                cursor: busy ? "not-allowed" : "pointer",
              }}
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
          style={{
            height: 40,
            width: "fit-content",
            padding: "0 14px",
            borderRadius: 10,
            border: "1px solid var(--color-border-default)",
            background: "var(--color-card-bg)",
            color: "var(--color-text-default)",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          Continue with GitHub
        </button>
      )}
    </div>
  );
}

