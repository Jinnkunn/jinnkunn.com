"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { Card } from "@/components/ui/card";
import { fmtIso, fmtWhen } from "@/components/site-admin/status/utils";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminContentSyncCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "stale" | "generated">;

function formatPendingDeployReason(reason: string | null | undefined): string {
  const raw = String(reason || "").trim();
  if (!raw) return "Active deployment sha unavailable";
  if (raw === "ACTIVE_DEPLOYMENT_SOURCE_SHA_UNAVAILABLE") {
    return "Active deployment does not expose source sha";
  }
  if (raw === "ACTIVE_DEPLOYMENT_SHA_UNAVAILABLE") {
    return "Active deployment sha unavailable";
  }
  if (raw === "SOURCE_HEAD_UNAVAILABLE") {
    return "Source head sha unavailable";
  }
  return raw;
}

export function SiteAdminContentSyncCard({ payload, stale, generated }: SiteAdminContentSyncCardProps) {
  const hasDeployTarget = payload.env.hasDeployTarget || payload.env.hasDeployHookUrl;
  return (
    <Card className="site-admin-card">
      <div className="site-admin-card__title">Content + Sync</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Source Store</dt>
          <dd>
            <code className="code">{payload.source.storeKind}</code>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Source Repo</dt>
          <dd>
            {payload.source.repo ? <code className="code">{payload.source.repo}</code> : <span>—</span>}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Source Branch</dt>
          <dd>
            {payload.source.branch ? <code className="code">{payload.source.branch}</code> : <span>—</span>}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Source Head</dt>
          <dd>
            {payload.source.headSha ? <code className="code">{payload.source.headSha.slice(0, 12)}</code> : <span>—</span>}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Head Time</dt>
          <dd>
            {payload.source.headCommitTime ? (
              <code className="code">{fmtIso(payload.source.headCommitTime)}</code>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Pending Deploy</dt>
          <dd>
            {payload.source.pendingDeploy === null ? (
              <>
                <span>—</span>
                <span className="site-admin-status__hint">
                  {" "}
                  {formatPendingDeployReason(payload.source.pendingDeployReason)}
                </span>
              </>
            ) : (
              <StatusBadge ok={!payload.source.pendingDeploy}>
                {payload.source.pendingDeploy ? "yes" : "no"}
              </StatusBadge>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Sync Meta</dt>
          <dd>
            {payload.content.syncMeta?.syncedAt ? (
              <code className="code">{fmtIso(payload.content.syncMeta.syncedAt)}</code>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Freshness</dt>
          <dd>
            <StatusBadge ok={stale.ok}>{stale.ok ? "up-to-date" : "stale"}</StatusBadge>
            {!stale.ok && stale.reason ? <span className="site-admin-status__hint"> {stale.reason}</span> : null}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Generated</dt>
          <dd>
            {Number.isFinite(generated.mtimeMs) ? (
              <>
                <code className="code">{fmtWhen(generated.mtimeMs)}</code>{" "}
                <StatusBadge ok={generated.ok}>{generated.ok ? "ok" : "mismatch"}</StatusBadge>
                {!generated.ok && generated.reason ? <span className="site-admin-status__hint"> {generated.reason}</span> : null}
              </>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Action</dt>
          <dd>
            {((!stale.ok || !generated.ok || payload.source.pendingDeploy === true) && hasDeployTarget) ? (
              <span>Deploy recommended</span>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Source Error</dt>
          <dd>{payload.source.error ? <span>{payload.source.error}</span> : <span>—</span>}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Admin Edited</dt>
          <dd>
            {payload.notion.adminPage?.lastEdited ? (
              <code className="code">{fmtIso(payload.notion.adminPage.lastEdited)}</code>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Root Edited</dt>
          <dd>
            {payload.notion.rootPage?.lastEdited ? (
              <code className="code">{fmtIso(payload.notion.rootPage.lastEdited)}</code>
            ) : (
              <span>—</span>
            )}
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Pages</dt>
          <dd>{payload.content.syncMeta?.pages ?? "—"}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Routes</dt>
          <dd>{payload.content.routesDiscovered}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Search Index</dt>
          <dd>{typeof payload.content.searchIndexItems === "number" ? <span>{payload.content.searchIndexItems} items</span> : <span>—</span>}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Overrides</dt>
          <dd>{payload.content.syncMeta?.routeOverrides ?? "—"}</dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Protected rules</dt>
          <dd>{payload.content.syncMeta?.protectedRules ?? "—"}</dd>
        </div>
      </dl>
    </Card>
  );
}
