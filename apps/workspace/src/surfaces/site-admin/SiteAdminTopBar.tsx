import { useSiteAdmin } from "./state";
import { SiteAdminConnectionPill } from "./SiteAdminConnectionPill";
import type { SiteAdminSectionDef, SiteAdminTab } from "./SiteAdminSidebar";

interface TopBarProps {
  sections: readonly SiteAdminSectionDef[];
  activeTab: SiteAdminTab;
}

function findCrumbs(
  sections: readonly SiteAdminSectionDef[],
  activeTab: SiteAdminTab,
): { section: string; tab: string } | null {
  for (const section of sections) {
    const hit = section.items.find((item) => item.id === activeTab);
    if (hit) return { section: section.label, tab: hit.label };
  }
  return null;
}

/** Thin top bar — left: breadcrumb (Site admin › Section › Tab), right:
 * connection status pill + dev drawer toggle. Replaces the always-visible
 * ConnectionCard and makes the active surface recognizable at a glance. */
export function SiteAdminTopBar({ sections, activeTab }: TopBarProps) {
  const { drawerOpen, toggleDrawer } = useSiteAdmin();
  const crumbs = findCrumbs(sections, activeTab);

  return (
    <header className="site-admin-topbar" role="banner">
      <nav className="site-admin-topbar__crumbs" aria-label="Breadcrumb">
        <span className="site-admin-topbar__crumb-root">Site admin</span>
        {crumbs && (
          <>
            <span className="site-admin-topbar__crumb-sep" aria-hidden="true">
              ›
            </span>
            <span className="site-admin-topbar__crumb-section">
              {crumbs.section}
            </span>
            <span className="site-admin-topbar__crumb-sep" aria-hidden="true">
              ›
            </span>
            <span className="site-admin-topbar__crumb-tab">{crumbs.tab}</span>
          </>
        )}
      </nav>

      <div className="site-admin-topbar__right">
        <SiteAdminConnectionPill />
        <button
          type="button"
          className="site-admin-topbar__drawer-btn"
          onClick={toggleDrawer}
          aria-pressed={drawerOpen}
          title="Toggle dev drawer (⌘\\)"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M2 3h12v10H2z M2 10h12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Debug</span>
        </button>
      </div>
    </header>
  );
}
