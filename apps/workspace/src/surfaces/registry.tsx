import { CalendarSurface } from "./calendar/CalendarSurface";
import { CalendarIcon, SiteAdminIcon } from "./icons";
import {
  SITE_ADMIN_DEFAULT_TAB,
  SITE_ADMIN_NAV_GROUPS,
} from "./site-admin/nav";
import { SiteAdminSurface } from "./site-admin/SiteAdminSurface";
import type { SurfaceDefinition } from "./types";

// Adding a new tool = add a component + drop an entry here. The shell
// doesn't know about individual surfaces — it just iterates this list
// to render the sidebar and picks the active one.
export const SURFACES: readonly SurfaceDefinition[] = [
  {
    id: "site-admin",
    title: "Site Admin",
    description: "Web publishing control plane",
    icon: <SiteAdminIcon />,
    Component: SiteAdminSurface,
    navGroups: SITE_ADMIN_NAV_GROUPS,
    defaultNavItemId: SITE_ADMIN_DEFAULT_TAB,
  },
  {
    id: "calendar",
    title: "Calendar",
    description: "Aggregated from macOS Calendar",
    icon: <CalendarIcon />,
    Component: CalendarSurface,
  },
];

export function findSurface(id: string): SurfaceDefinition | undefined {
  return SURFACES.find((surface) => surface.id === id);
}
