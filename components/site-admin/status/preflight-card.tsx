"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import type { StatusViewCoreProps } from "@/components/site-admin/status/view-types";

function summarize(items: string[], max = 3): string {
  if (!Array.isArray(items) || items.length === 0) return "—";
  const head = items.slice(0, max).join(", ");
  return items.length > max ? `${head}, +${items.length - max}` : head;
}

export function SiteAdminPreflightCard({ payload }: StatusViewCoreProps) {
  const pre = payload.preflight;

  return (
    <div className="site-admin-card">
      <div className="site-admin-card__title">Preflight</div>
      {!pre ? (
        <p className="site-admin-kv__muted" style={{ margin: 0 }}>
          No preflight data.
        </p>
      ) : (
        <dl className="site-admin-kv">
          <div className="site-admin-kv__row">
            <dt>Generated routes</dt>
            <dd>
              <StatusBadge ok={pre.generatedFiles.ok}>{pre.generatedFiles.ok ? "ok" : "missing"}</StatusBadge>
              <span className="site-admin-kv__muted">
                expected {pre.generatedFiles.expected}
                {pre.generatedFiles.missingRoutes.length > 0
                  ? ` · ${summarize(pre.generatedFiles.missingRoutes)}`
                  : ""}
              </span>
            </dd>
          </div>

          <div className="site-admin-kv__row">
            <dt>Route overrides</dt>
            <dd>
              <StatusBadge ok={pre.routeOverrides.ok}>{pre.routeOverrides.ok ? "ok" : "issue"}</StatusBadge>
              <span className="site-admin-kv__muted">
                orphan {pre.routeOverrides.orphanPageIds.length}
                {pre.routeOverrides.duplicatePaths.length > 0
                  ? ` · duplicate ${pre.routeOverrides.duplicatePaths.length}`
                  : ""}
              </span>
            </dd>
          </div>

          <div className="site-admin-kv__row">
            <dt>Nav links</dt>
            <dd>
              <StatusBadge ok={pre.navigation.ok}>{pre.navigation.ok ? "ok" : "invalid"}</StatusBadge>
              <span className="site-admin-kv__muted">
                {pre.navigation.invalidInternalHrefs.length > 0
                  ? summarize(pre.navigation.invalidInternalHrefs)
                  : "all internal links are valid"}
              </span>
            </dd>
          </div>

          <div className="site-admin-kv__row">
            <dt>Unsupported blocks</dt>
            <dd>
              <StatusBadge ok={pre.notionBlocks.ok}>
                {pre.notionBlocks.ok ? "none" : `${pre.notionBlocks.unsupportedBlockCount}`}
              </StatusBadge>
              <span className="site-admin-kv__muted">
                pages {pre.notionBlocks.pagesWithUnsupported}
                {pre.notionBlocks.sampleRoutes.length > 0
                  ? ` · ${summarize(pre.notionBlocks.sampleRoutes)}`
                  : ""}
              </span>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
