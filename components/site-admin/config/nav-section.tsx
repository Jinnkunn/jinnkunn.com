"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NavItemRow } from "./types";
import { SiteAdminNavList } from "./nav-list";

type SiteAdminNavSectionProps = {
  title: string;
  group: "top" | "more";
  rows: NavItemRow[];
  busy: boolean;
  openNav: Record<string, boolean>;
  navDraft: Record<string, Partial<NavItemRow>>;
  onAddRow: (group: "top" | "more") => void;
  onToggleOpenNav: (rowId: string) => void;
  onUpdateNavDraftField: (rowId: string, patch: Partial<NavItemRow>) => void;
  onSaveNavRow: (row: NavItemRow) => void;
  onClearNavDraft: (rowId: string) => void;
  className?: string;
};

export function SiteAdminNavSection({
  title,
  group,
  rows,
  busy,
  openNav,
  navDraft,
  onAddRow,
  onToggleOpenNav,
  onUpdateNavDraftField,
  onSaveNavRow,
  onClearNavDraft,
  className,
}: SiteAdminNavSectionProps) {
  return (
    <div className={className}>
      <div className="site-admin-nav-section__head">
        <Badge
          className={group === "top" ? "routes-explorer__pill routes-explorer__pill--nav" : "routes-explorer__pill"}
        >
          {title}
        </Badge>
        <Button
          type="button"
          className="site-admin-form__btn"
          disabled={busy}
          onClick={() => onAddRow(group)}
        >
          Add {group} item
        </Button>
      </div>

      <SiteAdminNavList
        rows={rows}
        group={group}
        busy={busy}
        openNav={openNav}
        navDraft={navDraft}
        onToggleOpenNav={onToggleOpenNav}
        onUpdateNavDraftField={onUpdateNavDraftField}
        onSaveNavRow={onSaveNavRow}
        onClearNavDraft={onClearNavDraft}
      />
    </div>
  );
}
