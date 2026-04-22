"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import type {
  RouteTreeItem,
  EffectiveAccess,
  OverrideConflict,
} from "@/lib/site-admin/route-explorer-model";
import type { AccessMode } from "@/lib/shared/access";
import { normalizeRoutePath } from "@/lib/shared/route-utils";

import { RouteRowAdminPanel } from "./route-row-admin-panel";
import { RouteRowTop } from "./route-row-top";

export function RouteRow({
  it,
  collapsed,
  adminOpen,
  busy,
  effectiveAccess,
  inheritedProtected,
  directProtected,
  overrideValue,
  overrideDirty,
  overridePending,
  accessPending,
  overrideConflict,
  selectedAccess,
  passwordValue,
  conflictLocked,
  onToggleCollapsed,
  onToggleAdmin,
  onSetOverrideValue,
  onSetAccessChoice,
  onSetPasswordValue,
  onSaveOverride,
  onSaveAccess,
}: {
  it: RouteTreeItem;
  collapsed: Record<string, boolean>;
  adminOpen: boolean;
  busy: boolean;
  effectiveAccess: EffectiveAccess | null;
  inheritedProtected: boolean;
  directProtected: boolean;
  overrideValue: string;
  overrideDirty: boolean;
  overridePending: boolean;
  accessPending: boolean;
  overrideConflict: OverrideConflict | null;
  selectedAccess: AccessMode;
  passwordValue: string;
  conflictLocked: boolean;
  onToggleCollapsed: (id: string) => void;
  onToggleAdmin: (id: string) => void;
  onSetOverrideValue: (id: string, value: string) => void;
  onSetAccessChoice: (id: string, v: AccessMode) => void;
  onSetPasswordValue: (id: string, value: string) => void;
  onSaveOverride: (id: string) => void;
  onSaveAccess: (input: { pageId: string; path: string }) => void;
}) {
  const p = normalizeRoutePath(it.routePath);
  const isHome = p === "/";
  const match = effectiveAccess;
  const effectiveProtected = Boolean(match);
  const protectedSource = match?.sourcePath || "";

  const protectedState = directProtected ? "direct" : inheritedProtected ? "inherited" : "0";

  const indent = Math.min(56, it.depth * 16);

  // Keep expensive DOM lookups out of event handlers; re-used within panel actions.
  const panelKey = useMemo(() => `ov:${it.id}:${overrideValue}`, [it.id, overrideValue]);
  const rowStyle = { "--indent": `${indent}px` } as CSSProperties & Record<"--indent", string>;

  return (
    <div
      className="routes-tree__row"
      role="listitem"
      data-nav={it.navGroup ? "1" : "0"}
      data-overridden={it.overridden ? "1" : "0"}
      data-protected={protectedState}
      data-protected-source={protectedSource || ""}
      data-depth={String(it.depth)}
      data-admin-open={adminOpen ? "1" : "0"}
      style={rowStyle}
    >
      <RouteRowTop
        it={it}
        collapsed={Boolean(collapsed[it.id])}
        isHome={isHome}
        adminOpen={adminOpen}
        overridePending={overridePending}
        accessPending={accessPending}
        overrideConflict={overrideConflict}
        directProtected={directProtected}
        inheritedProtected={inheritedProtected}
        effectiveAccess={effectiveAccess}
        onToggleCollapsed={onToggleCollapsed}
        onToggleAdmin={onToggleAdmin}
      />

      {adminOpen ? (
        <RouteRowAdminPanel
          key={panelKey}
          it={it}
          overrideValue={overrideValue}
          overrideDirty={overrideDirty}
          selectedAccess={selectedAccess}
          passwordValue={passwordValue}
          accessDirty={accessPending}
          inheritedProtected={inheritedProtected}
          effectiveProtected={effectiveProtected}
          protectedSource={protectedSource}
          busy={busy}
          conflictLocked={conflictLocked}
          overrideConflict={overrideConflict}
          onSetOverrideValue={onSetOverrideValue}
          onSetAccessChoice={onSetAccessChoice}
          onSetPasswordValue={onSetPasswordValue}
          onSaveOverride={onSaveOverride}
          onSaveAccess={onSaveAccess}
        />
      ) : null}
    </div>
  );
}
