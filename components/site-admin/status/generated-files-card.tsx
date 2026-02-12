"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { fmtWhen } from "@/components/site-admin/status/utils";
import type { StatusViewCoreProps } from "@/components/site-admin/status/view-types";

export function SiteAdminGeneratedFilesCard({ payload }: StatusViewCoreProps) {
  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Generated Files</div>
      <dl className="site-admin-kv">
        {(
          [
            ["site-config.json", payload.files.siteConfig],
            ["routes-manifest.json", payload.files.routesManifest],
            ["protected-routes.json", payload.files.protectedRoutes],
            ["sync-meta.json", payload.files.syncMeta],
            ["search-index.json", payload.files.searchIndex],
            ["routes.json", payload.files.routesJson],
          ] as const
        ).map(([name, st]) => (
          <div className="site-admin-kv__row" key={name}>
            <dt>{name}</dt>
            <dd>
              <StatusBadge ok={st.exists}>{st.exists ? "present" : "missing"}</StatusBadge>{" "}
              <span className="site-admin-kv__muted">{fmtWhen(st.mtimeMs)}</span>
            </dd>
          </div>
        ))}

        <div className="site-admin-kv__row">
          <dt>Sync cache</dt>
          <dd>
            <StatusBadge ok={payload.files.notionSyncCache.exists}>
              {payload.files.notionSyncCache.exists ? "present" : "missing"}
            </StatusBadge>{" "}
            <span className="site-admin-kv__muted">
              {payload.files.notionSyncCache.exists ? `${payload.files.notionSyncCache.count ?? 0} entries` : "—"}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
