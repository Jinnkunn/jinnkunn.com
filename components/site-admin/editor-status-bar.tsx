"use client";

import Link from "next/link";

import { cn } from "@/components/site-admin/config/utils";
import type { SiteAdminEditorStatus } from "@/lib/site-admin/editor-state";

type SiteAdminEditorStatusBarProps = {
  status: SiteAdminEditorStatus;
  busy?: boolean;
  canReload?: boolean;
  onReload?: () => void;
};

export function SiteAdminEditorStatusBar({
  status,
  busy = false,
  canReload = false,
  onReload,
}: SiteAdminEditorStatusBarProps) {
  const tone =
    status.kind === "conflict" || status.kind === "error"
      ? "warn"
      : status.kind === "saved"
        ? "ok"
        : status.kind === "saving"
          ? "info"
          : "idle";

  return (
    <div className={cn("site-admin-editor-status", `site-admin-editor-status--${tone}`)} role="status" aria-live="polite">
      <div className="site-admin-editor-status__main">
        <span className="site-admin-editor-status__badge">{status.kind}</span>
        <span className="site-admin-editor-status__message">{status.message}</span>
      </div>

      <div className="site-admin-editor-status__actions">
        {status.kind === "saved" ? (
          <Link href="/site-admin" className="site-admin-editor-status__link">
            Open Deploy
          </Link>
        ) : null}
        {canReload && onReload ? (
          <button
            type="button"
            className="site-admin-editor-status__button"
            onClick={onReload}
            disabled={busy}
          >
            {busy ? "Reloading..." : "Reload latest"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
