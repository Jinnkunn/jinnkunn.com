"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminRequirementsCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "readiness">;

export function SiteAdminRequirementsCard({ payload, readiness }: SiteAdminRequirementsCardProps) {
  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Admin Requirements</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Readiness</dt>
          <dd>
            <StatusBadge ok={readiness.ok}>{readiness.ok ? "ready" : "needs setup"}</StatusBadge>
            {!readiness.ok && readiness.reason ? <span className="site-admin-status__hint"> {readiness.reason}</span> : null}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>NEXTAUTH_SECRET</dt>
          <dd>
            <StatusBadge ok={payload.env.hasNextAuthSecret}>
              {payload.env.hasNextAuthSecret ? "configured" : "missing"}
            </StatusBadge>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>GitHub allowlist</dt>
          <dd>
            <code className="code">{payload.env.githubAllowlistCount}</code>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Content allowlist</dt>
          <dd>
            <code className="code">{payload.env.contentGithubAllowlistCount}</code>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Deploy Hook</dt>
          <dd>
            <StatusBadge ok={payload.env.hasDeployHookUrl}>
              {payload.env.hasDeployHookUrl ? "configured" : "missing"}
            </StatusBadge>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>FLAGS_SECRET</dt>
          <dd>
            <StatusBadge ok={payload.env.hasFlagsSecret}>
              {payload.env.hasFlagsSecret ? "configured" : "missing"}
            </StatusBadge>
          </dd>
        </div>
      </dl>
    </div>
  );
}
