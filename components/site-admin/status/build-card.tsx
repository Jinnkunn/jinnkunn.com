"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { Card } from "@/components/ui/card";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminBuildCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "deploymentLink">;

export function SiteAdminBuildCard({ payload, deploymentLink }: SiteAdminBuildCardProps) {
  return (
    <Card className="site-admin-card">
      <div className="site-admin-card__title">Build</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Environment</dt>
          <dd>
            <code className="code">{payload.env.nodeEnv || "unknown"}</code>{" "}
            <StatusBadge ok={payload.env.runtimeProvider !== "unknown"}>
              {payload.env.runtimeProvider}
            </StatusBadge>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Provider</dt>
          <dd>
            <code className="code">{payload.build.provider}</code>
            {payload.env.runtimeRegion ? (
              <span className="site-admin-status__hint"> {payload.env.runtimeRegion}</span>
            ) : null}
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
            {deploymentLink ? (
              <a className="notion-link link" href={deploymentLink} target="_blank" rel="noreferrer">
                {payload.build.deploymentUrl || payload.build.deploymentId || deploymentLink}
              </a>
            ) : (
              <span>{payload.build.deploymentId || "—"}</span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
