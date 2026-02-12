"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { fmtIso, fmtWhen } from "@/components/site-admin/status/utils";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminContentSyncCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "stale" | "generated">;

export function SiteAdminContentSyncCard({ payload, stale, generated }: SiteAdminContentSyncCardProps) {
  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Content + Sync</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Source Token</dt>
          <dd>
            <StatusBadge ok={payload.env.hasNotionToken}>{payload.env.hasNotionToken ? "configured" : "missing"}</StatusBadge>
          </dd>
        </div>
        <div className="site-admin-kv__row">
          <dt>Admin Page</dt>
          <dd>
            <StatusBadge ok={payload.env.hasNotionAdminPageId}>
              {payload.env.hasNotionAdminPageId ? "configured" : "missing"}
            </StatusBadge>
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
          <dd>{(!stale.ok || !generated.ok) && payload.env.hasDeployHookUrl ? <span>Deploy recommended</span> : <span>—</span>}</dd>
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
    </div>
  );
}
