"use client";

import type { EffectiveAccess, OverrideConflict } from "@/lib/site-admin/route-explorer-model";

import { LockIcon } from "./icons";
import { cn } from "./utils";

export function RouteRowBadges({
  navGroup,
  kind,
  overridden,
  overridePending,
  overrideConflict,
  directProtected,
  inheritedProtected,
  effectiveAccess,
}: {
  navGroup: string;
  kind: string;
  overridden: boolean;
  overridePending: boolean;
  overrideConflict: OverrideConflict | null;
  directProtected: boolean;
  inheritedProtected: boolean;
  effectiveAccess: EffectiveAccess | null;
}) {
  const match = effectiveAccess;
  const protectedSource = match?.sourcePath || "";

  return (
    <div className="routes-tree__badges">
      <span
        className={cn("routes-explorer__pill", navGroup ? "routes-explorer__pill--nav" : "")}
      >
        {navGroup ? `nav:${navGroup}` : kind}
      </span>
      {overridden || overridePending ? (
        <span className="routes-explorer__pill routes-explorer__pill--override">
          {overridePending ? "override (pending)" : "overridden"}
        </span>
      ) : null}
      {overrideConflict ? (
        <span
          className="routes-explorer__pill routes-explorer__pill--error"
          title={`Conflicts on ${overrideConflict.path}`}
        >
          conflict
        </span>
      ) : null}
      {directProtected ? (
        <span className="routes-explorer__pill routes-explorer__pill--protected">
          <LockIcon className="routes-explorer__pill-icon" />{" "}
          {match?.auth === "github" ? "GitHub" : "Password"}
        </span>
      ) : inheritedProtected ? (
        <span
          className="routes-explorer__pill routes-explorer__pill--protected routes-explorer__pill--protected-inherited"
          title={protectedSource ? `Inherited from ${protectedSource}` : "Inherited from a protected parent route"}
        >
          <LockIcon className="routes-explorer__pill-icon" />{" "}
          {match?.auth === "github" ? "GitHub" : "Password"}{" "}
          <span className="routes-explorer__pill-suffix">inherited</span>
        </span>
      ) : null}
    </div>
  );
}
