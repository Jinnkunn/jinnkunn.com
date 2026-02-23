"use client";

import type {
  RouteTreeItem,
  EffectiveAccess,
  OverrideConflict,
} from "@/lib/site-admin/route-explorer-model";

import { RouteKindIcon } from "./icons";
import { RouteRowActions } from "./route-row-actions";
import { RouteRowBadges } from "./route-row-badges";

export function RouteRowTop({
  it,
  collapsed,
  isHome,
  adminOpen,
  overridePending,
  overrideConflict,
  directProtected,
  inheritedProtected,
  effectiveAccess,
  onToggleCollapsed,
  onToggleAdmin,
}: {
  it: RouteTreeItem;
  collapsed: boolean;
  isHome: boolean;
  adminOpen: boolean;
  overridePending: boolean;
  overrideConflict: OverrideConflict | null;
  directProtected: boolean;
  inheritedProtected: boolean;
  effectiveAccess: EffectiveAccess | null;
  onToggleCollapsed: (id: string) => void;
  onToggleAdmin: (id: string) => void;
}) {
  return (
    <div className="routes-tree__row-top">
      <div className="routes-tree__left">
        {it.hasChildren ? (
          <button
            type="button"
            className="routes-explorer__expander"
            data-open={collapsed ? "false" : "true"}
            aria-label={collapsed ? "Expand" : "Collapse"}
            onClick={() => onToggleCollapsed(it.id)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              className="routes-explorer__chev"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span style={{ width: 22, height: 22, flex: "0 0 auto" }} />
        )}

        <RouteKindIcon
          className="routes-tree__kind-icon"
          kind={it.kind}
          hasChildren={it.hasChildren}
          isHome={isHome}
        />

        <div className="routes-tree__text">
          <div className="routes-tree__pathline">
            <code className="routes-tree__path">{it.routePath}</code>
            {isHome ? <span className="routes-tree__home">(home)</span> : null}
          </div>
          <div className="routes-tree__subline">
            <span className="routes-tree__title">{it.title || "Untitled"}</span>
            <span className="routes-tree__dot" aria-hidden="true">
              ·
            </span>
            <span className="routes-tree__id">{it.id}</span>
          </div>
        </div>
      </div>

      <div className="routes-tree__right">
        <RouteRowBadges
          navGroup={it.navGroup}
          kind={it.kind}
          overridden={it.overridden}
          overridePending={overridePending}
          overrideConflict={overrideConflict}
          directProtected={directProtected}
          inheritedProtected={inheritedProtected}
          effectiveAccess={effectiveAccess}
        />

        <RouteRowActions
          routePath={it.routePath}
          pageId={it.id}
          adminOpen={adminOpen}
          onToggleAdmin={() => onToggleAdmin(it.id)}
        />
      </div>
    </div>
  );
}
