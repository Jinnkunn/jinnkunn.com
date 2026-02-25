"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import type {
  RouteTreeItem,
  EffectiveAccess,
  AdminConfig,
  OverrideConflict,
} from "@/lib/site-admin/route-explorer-model";
import type { AccessMode } from "@/lib/shared/access";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";

import { RouteRowAdminPanel } from "./route-row-admin-panel";
import { RouteRowTop } from "./route-row-top";

export function RouteRow({
  it,
  cfg,
  collapsed,
  adminOpen,
  busy,
  accessChoice,
  effectiveAccess,
  inheritedProtected,
  directProtected,
  overrideValue,
  overridePending,
  overrideConflict,
  getOverrideConflict,
  onToggleCollapsed,
  onToggleAdmin,
  onSetAccessChoice,
  onSaveOverride,
  onSaveAccess,
}: {
  it: RouteTreeItem;
  cfg: AdminConfig;
  collapsed: Record<string, boolean>;
  adminOpen: boolean;
  busy: boolean;
  accessChoice: Record<string, AccessMode>;
  effectiveAccess: EffectiveAccess | null;
  inheritedProtected: boolean;
  directProtected: boolean;
  overrideValue: string;
  overridePending: boolean;
  overrideConflict: OverrideConflict | null;
  getOverrideConflict: (candidatePath: string) => OverrideConflict | null;
  onToggleCollapsed: (id: string) => void;
  onToggleAdmin: (id: string) => void;
  onSetAccessChoice: (id: string, v: AccessMode) => void;
  onSaveOverride: (id: string, v: string) => void;
  onSaveAccess: (input: { pageId: string; path: string; access: AccessMode; password?: string }) => void;
}) {
  const p = normalizeRoutePath(it.routePath);
  const isHome = p === "/";
  const match = effectiveAccess;
  const effectiveProtected = Boolean(match);
  const protectedSource = match?.sourcePath || "";

  const protectedState = directProtected ? "direct" : inheritedProtected ? "inherited" : "0";

  const indent = Math.min(56, it.depth * 16);

  const directAccess: AccessMode = directProtected
    ? cfg.protectedByPageId[compactId(it.id)]?.auth === "github"
      ? "github"
      : "password"
    : "public";

  const selectedAccess =
    accessChoice[it.id] ||
    (inheritedProtected ? (match?.auth === "github" ? "github" : "password") : directAccess);

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
          selectedAccess={selectedAccess}
          inheritedProtected={inheritedProtected}
          effectiveProtected={effectiveProtected}
          protectedSource={protectedSource}
          busy={busy}
          getOverrideConflict={getOverrideConflict}
          onSetAccessChoice={onSetAccessChoice}
          onSaveOverride={onSaveOverride}
          onSaveAccess={onSaveAccess}
        />
      ) : null}
    </div>
  );
}
