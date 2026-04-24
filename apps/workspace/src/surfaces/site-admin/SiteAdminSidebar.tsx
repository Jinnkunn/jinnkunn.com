import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";

export type SiteAdminTab =
  | "status"
  | "posts"
  | "pages"
  | "publications"
  | "news"
  | "config"
  | "routes";

export type SiteAdminSectionId = "content" | "site" | "ops";

export interface SiteAdminNavItemDef {
  id: SiteAdminTab;
  label: string;
  Icon: () => JSX.Element;
  /** Optional hint next to the label, e.g. "8". */
  badge?: ReactNode;
}

export interface SiteAdminSectionDef {
  id: SiteAdminSectionId;
  label: string;
  items: readonly SiteAdminNavItemDef[];
}

interface SiteAdminSidebarProps {
  sections: readonly SiteAdminSectionDef[];
  activeTab: SiteAdminTab;
  onSelect: (tab: SiteAdminTab) => void;
}

const COLLAPSE_STORAGE_KEY = "workspace.site-admin.sidebar.sections.v1";

function loadCollapsed(): Partial<Record<SiteAdminSectionId, boolean>> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<SiteAdminSectionId, boolean>> = {};
    for (const id of ["content", "site", "ops"] as const) {
      if (typeof parsed[id] === "boolean") out[id] = parsed[id] as boolean;
    }
    return out;
  } catch {
    return {};
  }
}

function persistCollapsed(state: Partial<Record<SiteAdminSectionId, boolean>>): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — quota / private mode; state stays in-memory
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: "transform 140ms ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
      }}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function SiteAdminSidebar({
  sections,
  activeTab,
  onSelect,
}: SiteAdminSidebarProps) {
  const [collapsed, setCollapsed] = useState<
    Partial<Record<SiteAdminSectionId, boolean>>
  >(() => loadCollapsed());

  useEffect(() => {
    persistCollapsed(collapsed);
  }, [collapsed]);

  const toggleSection = useCallback((id: SiteAdminSectionId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const activeSection = useMemo(
    () => sections.find((s) => s.items.some((i) => i.id === activeTab))?.id ?? null,
    [activeTab, sections],
  );

  // Render-time derivation: a section that contains the active tab is always
  // rendered open, even if the user previously collapsed it. This avoids the
  // "caret lands on an invisible item" case without needing a setState inside
  // useEffect (which the react-hooks lint rule rightly flags).
  const isOpen = useCallback(
    (id: SiteAdminSectionId): boolean => {
      if (id === activeSection) return true;
      return !collapsed[id];
    },
    [activeSection, collapsed],
  );

  return (
    <aside
      className="site-admin-sidebar"
      role="navigation"
      aria-label="Site admin navigation"
    >
      {sections.map((section) => {
        const open = isOpen(section.id);
        return (
          <div key={section.id} className="site-admin-sidebar__section">
            <button
              type="button"
              className="site-admin-sidebar__section-header"
              onClick={() => toggleSection(section.id)}
              aria-expanded={open}
              aria-controls={`site-admin-section-${section.id}`}
              data-active={activeSection === section.id ? "true" : undefined}
            >
              <ChevronIcon open={open} />
              <span>{section.label}</span>
            </button>
            {open && (
              <ul
                id={`site-admin-section-${section.id}`}
                className="site-admin-sidebar__items"
                role="list"
              >
                {section.items.map((item) => {
                  const active = item.id === activeTab;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="sidebar-nav-item site-admin-sidebar__item"
                        onClick={() => onSelect(item.id)}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="sidebar-nav-item-icon">
                          <item.Icon />
                        </span>
                        <span className="site-admin-sidebar__item-label">
                          {item.label}
                        </span>
                        {item.badge !== undefined && item.badge !== null && (
                          <span className="site-admin-sidebar__badge">{item.badge}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </aside>
  );
}
