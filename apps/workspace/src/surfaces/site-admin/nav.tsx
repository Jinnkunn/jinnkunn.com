import {
  ConfigIcon,
  HomeIcon,
  PagesIcon,
  PostsIcon,
  PublicationsIcon,
  StatusIcon,
} from "../icons";
import type { SurfaceNavGroup } from "../types";
import type { SiteAdminTab } from "./types";

/** Nav tree for the Site Admin surface. Rendered by the shell sidebar
 * as collapsible groups under "Site Admin". Grouped into three buckets
 * so the sidebar communicates intent:
 *   Content → day-to-day authoring
 *   Site    → configuration that tunes the public site
 *   Ops     → runtime / deployment health
 *
 * The nav leaf ids must be a subset of `SiteAdminTab` — the surface
 * narrows the incoming id before switching on it. */
export const SITE_ADMIN_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: "content",
    label: "Content",
    items: [
      { id: "home", label: "Home", icon: <HomeIcon /> },
      { id: "posts", label: "Posts", icon: <PostsIcon />, canAddChild: true },
      {
        id: "pages",
        label: "Pages",
        icon: <PagesIcon />,
        canAddChild: true,
        // Drop a page row onto Pages itself to move it back to the
        // root (slug becomes its leaf only).
        droppable: true,
      },
      { id: "publications", label: "Publications", icon: <PublicationsIcon /> },
    ],
  },
  {
    id: "site",
    label: "Site",
    // The Settings surface (Phase 5) bundles what used to be two
    // separate sidebar entries — Settings & Navigation + Routes — into
    // one super.so-style settings page with horizontal sub-tabs.
    items: [
      { id: "settings", label: "Settings", icon: <ConfigIcon /> },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [{ id: "status", label: "Status", icon: <StatusIcon /> }],
  },
];

/** Default leaf when the surface mounts for the first time / persisted
 * value has been removed from the nav. Status is intentional: it's a
 * read-only sanity check, safe to land on before the user signs in. */
export const SITE_ADMIN_DEFAULT_TAB: SiteAdminTab = "status";

/** All valid tab ids flattened, for bounds-checking a persisted value
 * before trusting it. */
export const SITE_ADMIN_TAB_IDS: readonly SiteAdminTab[] =
  SITE_ADMIN_NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => item.id as SiteAdminTab),
  );

export function isSiteAdminTab(value: unknown): value is SiteAdminTab {
  return typeof value === "string"
    && (SITE_ADMIN_TAB_IDS as readonly string[]).includes(value);
}
