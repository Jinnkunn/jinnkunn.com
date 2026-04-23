"use client";

import { StatusBadge } from "@/components/site-admin/status/badge";
import { Card } from "@/components/ui/card";
import type { StatusViewCoreProps } from "@/components/site-admin/status/view-types";

/**
 * Diagnostics card — renders the last slice of the admin error ring
 * that `/api/site-admin/status` returns via the `diagnostics` field.
 *
 * Shape:
 *   - A pill that greens/reds on zero/non-zero errors.
 *   - Counts line ("{warn} warnings · {error} errors · since {oldestAt}").
 *   - A small tail list of the most recent events: time, severity chip,
 *     source tag, message, optional detail snippet.
 *
 * Admins can see "D1 audit sink failed" or "rate limiter blocked N
 * requests" without having to tail wrangler logs. Zero state shows a
 * neutral "No recent events" line so the card is never empty.
 */
export function SiteAdminDiagnosticsCard({ payload }: StatusViewCoreProps) {
  const diag = payload.diagnostics;

  const ok = !diag || diag.errorCount === 0;
  const title = (
    <div className="site-admin-card__title">
      Diagnostics{" "}
      <StatusBadge ok={ok}>
        {!diag ? "n/a" : diag.errorCount > 0 ? `${diag.errorCount} errors` : "healthy"}
      </StatusBadge>
    </div>
  );

  if (!diag) {
    return (
      <Card className="site-admin-card">
        {title}
        <p className="site-admin-kv__muted">No diagnostics data.</p>
      </Card>
    );
  }

  const windowSince = formatRelative(diag.oldestAt);

  return (
    <Card className="site-admin-card">
      {title}
      <p className="site-admin-kv__muted">
        {diag.warnCount} warnings · {diag.errorCount} errors
        {windowSince ? ` · since ${windowSince}` : ""}
        {" · "}
        showing last {diag.recent.length}
      </p>
      {diag.recent.length === 0 ? (
        <p className="site-admin-kv__muted">No recent events.</p>
      ) : (
        <ul className="site-admin-diagnostics__list">
          {diag.recent
            .slice()
            .reverse()
            .map((ev, i) => (
              <li
                key={`${ev.at}-${i}`}
                className="site-admin-diagnostics__item"
                data-severity={ev.severity}
              >
                <span className="site-admin-diagnostics__time">{formatTime(ev.at)}</span>
                <span className="site-admin-diagnostics__sev" data-severity={ev.severity}>
                  {ev.severity}
                </span>
                <span className="site-admin-diagnostics__source">{ev.source}</span>
                <span className="site-admin-diagnostics__message">{ev.message}</span>
                {ev.detail ? (
                  <span className="site-admin-diagnostics__detail">{ev.detail}</span>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const deltaMs = Math.max(0, Date.now() - then);
    const minutes = Math.round(deltaMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}
