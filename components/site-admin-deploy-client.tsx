"use client";

import { useState } from "react";

type Result =
  | { ok: true; triggeredAt: string; status: number }
  | { ok: false; error: string };

export default function SiteAdminDeployClient() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  const onDeploy = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/site-admin/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = (await r.json().catch(() => null)) as Result | null;
      setRes(data || { ok: false, error: `Request failed (${r.status})` });
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        type="button"
        onClick={onDeploy}
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
          fontWeight: 650,
        }}
      >
        {busy ? "Deploying..." : "Deploy"}
      </button>

      {res ? (
        <p className="notion-text notion-text__content notion-semantic-string">
          {res.ok ? (
            <>
              Deploy triggered ({res.status}) at <code className="code">{res.triggeredAt}</code>.
            </>
          ) : (
            <span className="highlighted-color color-red">{res.error}</span>
          )}
        </p>
      ) : null}
    </div>
  );
}

