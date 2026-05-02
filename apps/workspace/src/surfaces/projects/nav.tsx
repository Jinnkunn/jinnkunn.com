import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CircleCheckBig,
  FolderKanban,
  Home,
  PauseCircle,
  PlayCircle,
} from "lucide-react";

import type { ProjectRow } from "../../modules/projects/api";
import type { SurfaceNavGroup, SurfaceNavItem } from "../types";

export const PROJECTS_HOME_NAV_ID = "projects:home";
export const PROJECTS_ACTIVE_NAV_ID = "projects:active";
export const PROJECTS_PAUSED_NAV_ID = "projects:paused";
export const PROJECTS_COMPLETED_NAV_ID = "projects:completed";
export const PROJECTS_ARCHIVED_NAV_ID = "projects:archived";
export const PROJECTS_ROOT_NAV_ID = "projects:root";
export const PROJECTS_ADD_NAV_ID = `add:${PROJECTS_ROOT_NAV_ID}`;
export const PROJECTS_DEFAULT_NAV_ITEM_ID = PROJECTS_HOME_NAV_ID;

export const PROJECTS_VIEWS_GROUP_ID = "projects:views";
export const PROJECTS_LIST_GROUP_ID = "projects:list";
export const PROJECTS_SYSTEM_GROUP_ID = "projects:system";

export const PROJECT_NAV_PREFIX = "project:";

export type ProjectsNavItemId =
  | typeof PROJECTS_ACTIVE_NAV_ID
  | typeof PROJECTS_ARCHIVED_NAV_ID
  | typeof PROJECTS_COMPLETED_NAV_ID
  | typeof PROJECTS_HOME_NAV_ID
  | typeof PROJECTS_PAUSED_NAV_ID;

export type ProjectsNavCounts = Partial<Record<ProjectsNavItemId, number>>;

export function projectNavId(id: string): string {
  return `${PROJECT_NAV_PREFIX}${id}`;
}

export function projectIdFromNavItem(
  navItemId: string | null | undefined,
): string | null {
  if (!navItemId?.startsWith(PROJECT_NAV_PREFIX)) return null;
  return navItemId.slice(PROJECT_NAV_PREFIX.length) || null;
}

export function isProjectCreateNavItem(
  navItemId: string | null | undefined,
): boolean {
  return navItemId === PROJECTS_ADD_NAV_ID;
}

function navIcon(Icon: LucideIcon) {
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={14}
      strokeWidth={1.65}
    />
  );
}

function badge(
  counts: ProjectsNavCounts,
  id: ProjectsNavItemId,
): SurfaceNavItem["badge"] {
  const count = counts[id];
  return count ? String(count) : undefined;
}

function navItem(
  counts: ProjectsNavCounts,
  id: ProjectsNavItemId,
  label: string,
  Icon: LucideIcon,
): SurfaceNavItem {
  return {
    id,
    label,
    badge: badge(counts, id),
    icon: navIcon(Icon),
  };
}

export function projectRowsToNavItems(
  projects: readonly ProjectRow[],
): SurfaceNavItem[] {
  return projects
    .filter((project) => project.archivedAt === null)
    .map((project) => ({
      id: projectNavId(project.id),
      label: project.title || "Untitled Project",
      renameValue: project.title || "Untitled Project",
      badge: project.openTodoCount ? String(project.openTodoCount) : undefined,
      icon: navIcon(FolderKanban),
      draggable: true,
      droppable: true,
      orderable: true,
    }));
}

export function createProjectsNavGroups(
  counts: ProjectsNavCounts = {},
  projectItems: readonly SurfaceNavItem[] = [],
): readonly SurfaceNavGroup[] {
  return [
    {
      id: PROJECTS_VIEWS_GROUP_ID,
      label: "Views",
      items: [
        navItem(counts, PROJECTS_HOME_NAV_ID, "Home", Home),
        navItem(counts, PROJECTS_ACTIVE_NAV_ID, "Active", PlayCircle),
        navItem(counts, PROJECTS_PAUSED_NAV_ID, "Paused", PauseCircle),
        navItem(counts, PROJECTS_COMPLETED_NAV_ID, "Completed", CircleCheckBig),
      ],
    },
    {
      id: PROJECTS_LIST_GROUP_ID,
      label: "Projects",
      addItemId: PROJECTS_ADD_NAV_ID,
      addLabel: "New project",
      items: projectItems.length
        ? projectItems
        : [
            {
              id: PROJECTS_ADD_NAV_ID,
              label: "New project",
              icon: navIcon(FolderKanban),
            },
          ],
    },
    {
      id: PROJECTS_SYSTEM_GROUP_ID,
      label: "System",
      items: [
        navItem(counts, PROJECTS_ARCHIVED_NAV_ID, "Archived", Archive),
      ],
    },
  ];
}

export const PROJECTS_NAV_GROUPS: readonly SurfaceNavGroup[] =
  createProjectsNavGroups();
