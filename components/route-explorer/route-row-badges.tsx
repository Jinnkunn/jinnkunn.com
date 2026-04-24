"use client";

import { Badge } from "@/components/ui/badge";
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
      <Badge
        className={cn("routes-explorer__pill", navGroup ? "routes-explorer__pill--nav" : "")}
      >
        {navGroup ? `nav:${navGroup}` : kind}
      </Badge>
      {overridden || overridePending ? (
        <Badge className="routes-explorer__pill routes-explorer__pill--override">
          {overridePending ? "override (pending)" : "overridden"}
        </Badge>
      ) : null}
      {overrideConflict ? (
        <Badge
          className="routes-explorer__pill routes-explorer__pill--error"
          title={`Conflicts on ${overrideConflict.path}`}
        >
          conflict
        </Badge>
      ) : null}
      {directProtected ? (
        <Badge className="routes-explorer__pill routes-explorer__pill--protected">
          <LockIcon className="routes-explorer__pill-icon" />{" "}
          {match?.auth === "github" ? "GitHub" : "Password"}
        </Badge>
      ) : inheritedProtected ? (
        <Badge
          className="routes-explorer__pill routes-explorer__pill--protected routes-explorer__pill--protected-inherited"
          title={protectedSource ? `Inherited from ${protectedSource}` : "Inherited from a protected parent route"}
        >
          <LockIcon className="routes-explorer__pill-icon" />{" "}
          {match?.auth === "github" ? "GitHub" : "Password"}{" "}
          <span className="routes-explorer__pill-suffix">inherited</span>
        </Badge>
      ) : null}
    </div>
  );
}
