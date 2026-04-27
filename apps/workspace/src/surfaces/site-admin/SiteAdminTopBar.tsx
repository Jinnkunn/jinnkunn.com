import type { SurfaceNavGroup, SurfaceNavItem } from "../types";
import { handleWindowDragMouseDown } from "../../shell/windowDrag";
import { useSiteAdmin } from "./state";
import { SiteAdminConnectionPill } from "./SiteAdminConnectionPill";
import type { SiteAdminTab } from "./types";

interface TopBarProps {
  sections: readonly SurfaceNavGroup[];
  activeTab: SiteAdminTab;
}

// Hardcoded fallback labels for tab ids that aren't reachable from a
// static nav row (Phase 1 nav reshape: Posts/Pages are no longer
// top-level — they're injected as children of Home — so plain
// `activeTab === "posts"` won't match any static item).
const TAB_FALLBACK_LABELS: Record<SiteAdminTab, string> = {
  status: "Status",
  home: "Home",
  posts: "Blog",
  pages: "Pages",
  components: "Shared",
  settings: "Settings",
};

// Walk the nav tree depth-first looking for the row whose id matches
// `activeTab`, returning the section label so the breadcrumb can show
// "Content › Blog". Recurses through `children` so dynamic sub-rows
// resolve to the right section.
function findInItems(
  items: readonly SurfaceNavItem[],
  activeTab: SiteAdminTab,
): SurfaceNavItem | null {
  for (const item of items) {
    if (item.id === activeTab) return item;
    if (item.children) {
      const hit = findInItems(item.children, activeTab);
      if (hit) return hit;
    }
  }
  return null;
}

function findCrumbs(
  sections: readonly SurfaceNavGroup[],
  activeTab: SiteAdminTab,
): { section: string; tab: string } {
  for (const section of sections) {
    const hit = findInItems(section.items, activeTab);
    if (hit) return { section: section.label, tab: hit.label };
  }
  // Fallback: when the dynamic children haven't been injected yet
  // (first render before the eager-fetch resolves), still show a
  // sensible label rather than the bare "Site admin" placeholder.
  return { section: "Content", tab: TAB_FALLBACK_LABELS[activeTab] };
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
    <header
      className="site-admin-topbar"
      role="banner"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
    >
      <nav className="site-admin-topbar__crumbs" aria-label="Breadcrumb">
        <span className="site-admin-topbar__crumb-section">
          {crumbs.section}
        </span>
        <span className="site-admin-topbar__crumb-sep" aria-hidden="true">
          ›
        </span>
        <span className="site-admin-topbar__crumb-tab">{crumbs.tab}</span>
      </nav>

      <div className="site-admin-topbar__right" data-window-drag-exclude>
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
