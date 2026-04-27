import {
  ConfigIcon,
  HomeIcon,
  PostsIcon,
  StatusIcon,
} from "../icons";
import type { SurfaceNavGroup, SurfaceNavItem } from "../types";
import type { SiteAdminTab } from "./types";
import { SITE_COMPONENT_DEFINITIONS } from "../../../../../lib/site-admin/component-registry.ts";

/** Static children of the "Components" group — the four reusable MDX
 * widgets. Each leaf id is `components:<name>`; clicking it routes to
 * the Components panel scoped to that name. Unlike Posts/Pages there
 * are no dynamic children to inject (no per-entry leaves) — the
 * granularity stops at the component name. */
const COMPONENT_LEAVES: readonly SurfaceNavItem[] = [
  ...SITE_COMPONENT_DEFINITIONS.map((definition) => ({
    id: `components:${definition.name}`,
    label: definition.label,
  })),
] as const;

/** Nav tree for the Site Admin surface. Rendered by the shell sidebar
 * as collapsible groups under "Site Admin". The tree mirrors the
 * public site hierarchy:
 *   Content → Home (= /), with Blog (posts) and every standalone page
 *             rendered as children
 *   Site    → site-wide configuration
 *   Ops     → runtime / deployment health
 *
 * Posts/pages no longer have their own top-level nav rows — their
 * leaves are injected as children of `home` by the surface
 * (see SiteAdminSurface.tsx). The tab ids "posts" / "pages" still
 * exist on `SiteAdminTab` because clicking a Blog sub-node or a page
 * leaf routes to the corresponding panel; they just aren't reachable
 * from a static row anymore. */
export const SITE_ADMIN_NAV_GROUPS: readonly SurfaceNavGroup[] = [
  {
    id: "content",
    label: "Content",
    items: [
      {
        id: "home",
        label: "Home",
        icon: <HomeIcon />,
        // "+" on Home creates a new page at root (the surface decodes
        // "add:home" into a fresh PageEditor). Home is also a drop
        // target so dragging a nested page onto Home reparents it to
        // the root.
        canAddChild: true,
        droppable: true,
      },
      {
        id: "components",
        label: "Shared",
        icon: <PostsIcon />,
        // Static four-leaf sub-tree — News / Teaching / Publications /
        // Works. No "+" affordance because the names are fixed by
        // code (component shortcodes have to be registered as React
        // components too).
        children: COMPONENT_LEAVES,
      },
    ],
  },
  {
    id: "site",
    label: "Site",
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

/** All valid tab ids — kept in sync manually with the `SiteAdminTab`
 * union. Two of these ("posts", "pages") aren't reachable from a
 * static nav row; they're activated when the user clicks a dynamic
 * child injected under `home` (Blog sub-tree or a page leaf). */
export const SITE_ADMIN_TAB_IDS: readonly SiteAdminTab[] = [
  "status",
  "home",
  "posts",
  "pages",
  "components",
  "settings",
];

export function isSiteAdminTab(value: unknown): value is SiteAdminTab {
  return typeof value === "string"
    && (SITE_ADMIN_TAB_IDS as readonly string[]).includes(value);
}
