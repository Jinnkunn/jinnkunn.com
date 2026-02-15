"use client";

import { useState } from "react";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";
import { triggerSiteAdminDeploy } from "@/lib/client/site-admin-deploy";

export default function SiteAdminDeployClient() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SiteAdminDeployResult | null>(null);

  const onDeploy = async () => {
    setBusy(true);
    setRes(null);
    const data = await triggerSiteAdminDeploy();
    setRes(data);
    setBusy(false);
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
