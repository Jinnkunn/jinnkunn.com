"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminBuildCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "vercelLink">;

export function SiteAdminBuildCard({ payload, vercelLink }: SiteAdminBuildCardProps) {
  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Build</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Environment</dt>
          <dd>
            <code className="code">{payload.env.nodeEnv || "unknown"}</code>{" "}
            {payload.env.isVercel ? <StatusBadge ok>Vercel</StatusBadge> : <StatusBadge ok={false}>Local</StatusBadge>}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Commit</dt>
          <dd>{payload.build.commitShort ? <code className="code">{payload.build.commitShort}</code> : <span>—</span>}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Branch</dt>
          <dd>{payload.build.branch || "—"}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Deployment</dt>
          <dd>
            {vercelLink ? (
              <a className="notion-link link" href={vercelLink} target="_blank" rel="noreferrer">
                {payload.build.vercelUrl}
              </a>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
