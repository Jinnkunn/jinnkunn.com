"use client";

import { useState } from "react";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";
import { asApiAck, isRecord } from "@/lib/client/api-guards";
import { requestJsonOrThrow } from "@/lib/client/request-json";

type DeployOk = Extract<SiteAdminDeployResult, { ok: true }>;

function isDeployOk(v: SiteAdminDeployResult): v is DeployOk {
  return v.ok;
}

function asDeployResult(x: unknown): SiteAdminDeployResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return ack;
  if (!isRecord(x)) return null;
  if (typeof x.triggeredAt !== "string" || typeof x.status !== "number") return null;
  return { ok: true, triggeredAt: x.triggeredAt, status: x.status };
}

export default function SiteAdminDeployClient() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SiteAdminDeployResult | null>(null);

  const onDeploy = async () => {
    setBusy(true);
    setRes(null);
    try {
      const data = await requestJsonOrThrow(
        "/api/site-admin/deploy",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        asDeployResult,
        { isOk: isDeployOk },
      );
      setRes(data);
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
