"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { fmtIso, fmtWhen } from "@/components/site-admin/status/utils";
import type { StatusViewCoreProps, StatusViewDerivedProps } from "@/components/site-admin/status/view-types";

type SiteAdminContentSyncCardProps = StatusViewCoreProps & Pick<StatusViewDerivedProps, "stale" | "generated">;

export function SiteAdminContentSyncCard({ payload, stale, generated }: SiteAdminContentSyncCardProps) {
  const isNotion = payload.env.contentSource === "notion";
  const sourceUpdatedMs = payload.source.headCommittedAt
    ? Date.parse(payload.source.headCommittedAt)
    : (payload.freshness?.notionEditedMs ?? null);
  const sourceStore = payload.source.storeKind || (isNotion ? "legacy-notion" : "local");
  const deployRecommended = payload.source.pendingDeploy || !stale.ok || !generated.ok;

  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Content + Sync</div>
      <dl className="site-admin-kv">
        <div className="site-admin-kv__row">
          <dt>Content Source</dt>
          <dd>
            <code className="code">{payload.env.contentSource || "filesystem"}</code>
          </dd>
        </div>
        {isNotion ? (
          <>
            <div className="site-admin-kv__row">
              <dt>Source Token</dt>
              <dd>
                <StatusBadge ok={payload.env.hasNotionToken}>
                  {payload.env.hasNotionToken ? "configured" : "missing"}
                </StatusBadge>
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
          </>
        ) : null}
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
        {!isNotion ? (
          <>
            <div className="site-admin-kv__row">
              <dt>Source Store</dt>
              <dd>
                <code className="code">{sourceStore}</code>
              </dd>
            </div>
            <div className="site-admin-kv__row">
              <dt>Source Repo</dt>
              <dd>{payload.source.repo ? <code className="code">{payload.source.repo}</code> : <span>—</span>}</dd>
            </div>
            <div className="site-admin-kv__row">
              <dt>Source Branch</dt>
              <dd>{payload.source.branch ? <code className="code">{payload.source.branch}</code> : <span>—</span>}</dd>
            </div>
            <div className="site-admin-kv__row">
              <dt>Source Head</dt>
              <dd>{payload.source.headSha ? <code className="code">{payload.source.headSha.slice(0, 12)}</code> : <span>—</span>}</dd>
            </div>
            <div className="site-admin-kv__row">
              <dt>Pending Deploy</dt>
              <dd>
                <StatusBadge ok={!payload.source.pendingDeploy}>
                  {payload.source.pendingDeploy ? "yes" : "no"}
                </StatusBadge>
              </dd>
            </div>
            {payload.source.error ? (
              <div className="site-admin-kv__row">
                <dt>Source Error</dt>
                <dd>
                  <span className="site-admin-status__hint">{payload.source.error}</span>
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
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
          <dd>{deployRecommended && payload.env.hasDeployHookUrl ? <span>Deploy recommended</span> : <span>—</span>}</dd>
        </div>
        {isNotion ? (
          <>
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
          </>
        ) : (
          <div className="site-admin-kv__row">
            <dt>Source Updated</dt>
            <dd>
              {typeof sourceUpdatedMs === "number" && Number.isFinite(sourceUpdatedMs) ? (
                <code className="code">{fmtWhen(sourceUpdatedMs)}</code>
              ) : (
                <span>—</span>
              )}
            </dd>
          </div>
        )}
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
