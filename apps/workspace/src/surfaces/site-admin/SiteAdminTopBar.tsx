import type { SurfaceNavGroup } from "../types";
import { useSiteAdmin } from "./state";
import { SiteAdminConnectionPill } from "./SiteAdminConnectionPill";
import type { SiteAdminTab } from "./types";

interface TopBarProps {
  sections: readonly SurfaceNavGroup[];
  activeTab: SiteAdminTab;
}

function findCrumbs(
  sections: readonly SurfaceNavGroup[],
  activeTab: SiteAdminTab,
): { section: string; tab: string } | null {
  for (const section of sections) {
    const hit = section.items.find((item) => item.id === activeTab);
    if (hit) return { section: section.label, tab: hit.label };
  }
  return null;
}

/** Thin top bar — left: breadcrumb (Section › Tab), right: connection
 * status pill + dev drawer toggle. The window titlebar already shows
 * "Workspace › Site Admin", so this row drops the "Site admin" prefix
 * and starts at the section. The breadcrumb still earns its keep when
 * a user collapses the parent group in the sidebar (the active item
 * stops being visible there). */
export function SiteAdminTopBar({ sections, activeTab }: TopBarProps) {
  const { drawerOpen, toggleDrawer } = useSiteAdmin();
  const crumbs = findCrumbs(sections, activeTab);

  return (
    <header className="site-admin-topbar" role="banner">
      <nav className="site-admin-topbar__crumbs" aria-label="Breadcrumb">
        {crumbs ? (
          <>
            <span className="site-admin-topbar__crumb-section">
              {crumbs.section}
            </span>
            <span className="site-admin-topbar__crumb-sep" aria-hidden="true">
              ›
            </span>
            <span className="site-admin-topbar__crumb-tab">{crumbs.tab}</span>
          </>
        ) : (
          <span className="site-admin-topbar__crumb-tab">Site admin</span>
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
