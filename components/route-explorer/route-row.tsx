"use client";

import type { CSSProperties } from "react";
import { memo, useMemo } from "react";

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

type RouteRowProps = {
  it: RouteTreeItem;
  cfg: AdminConfig;
  isCollapsed: boolean;
  adminOpen: boolean;
  busy: boolean;
  selectedAccessChoice: AccessMode | undefined;
  effectiveAccess: EffectiveAccess | null;
  inheritedProtected: boolean;
  directProtected: boolean;
  overrideValue: string;
  overridePending: boolean;
  overrideConflict: OverrideConflict | null;
  findOverrideConflict: (pageId: string, candidatePath: string) => OverrideConflict | null;
  onToggleCollapsed: (id: string) => void;
  onToggleAdmin: (id: string) => void;
  onSetAccessChoice: (id: string, v: AccessMode) => void;
  onSaveOverride: (id: string, v: string) => void;
  onSaveAccess: (input: { pageId: string; path: string; access: AccessMode; password?: string }) => void;
};

function RouteRowInner({
  it,
  cfg,
  isCollapsed,
  adminOpen,
  busy,
  selectedAccessChoice,
  effectiveAccess,
  inheritedProtected,
  directProtected,
  overrideValue,
  overridePending,
  overrideConflict,
  findOverrideConflict,
  onToggleCollapsed,
  onToggleAdmin,
  onSetAccessChoice,
  onSaveOverride,
  onSaveAccess,
}: RouteRowProps) {
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
    selectedAccessChoice ||
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
        collapsed={isCollapsed}
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
          findOverrideConflict={findOverrideConflict}
          onSetAccessChoice={onSetAccessChoice}
          onSaveOverride={onSaveOverride}
          onSaveAccess={onSaveAccess}
        />
      ) : null}
    </div>
  );
}

/**
 * `RouteRow` renders a row inside the admin RouteExplorer list. The parent
 * passes down aggregate state (`collapsed`, `accessChoice`) that changes on
 * every click somewhere in the tree — without memoisation, every row
 * re-renders for every collapse/admin/toggle, even when the row's own
 * inputs are unchanged.
 *
 * We hoist the per-row lookups up to the parent (so the props we accept
 * here are already row-scoped scalars, not the full maps) and wrap the
 * component in `memo`. With primitive props and stable handler identities,
 * the default shallow comparator is exactly what we want.
 */
export const RouteRow = memo(RouteRowInner);
