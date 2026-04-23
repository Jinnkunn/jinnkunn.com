import { CalendarSurface } from "./CalendarSurface";
import { CalendarIcon, SiteAdminIcon } from "./icons";
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
  },
  {
    id: "calendar",
    title: "Calendar",
    description: "Coming soon",
    icon: <CalendarIcon />,
    Component: CalendarSurface,
    disabled: true,
  },
];

export function findSurface(id: string): SurfaceDefinition | undefined {
  return SURFACES.find((surface) => surface.id === id);
}
