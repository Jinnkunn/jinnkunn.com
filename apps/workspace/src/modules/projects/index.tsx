import { lazy } from "react";

import { ProjectsIcon } from "../../surfaces/icons";
import {
  PROJECTS_DEFAULT_NAV_ITEM_ID,
  PROJECTS_NAV_GROUPS,
} from "../../surfaces/projects/nav";
import type { WorkspaceModuleDefinition } from "../types";

const ProjectsSurface = lazy(() =>
  import("../../surfaces/projects/ProjectsSurface").then((module) => ({
    default: module.ProjectsSurface,
  })),
);

export const PROJECTS_MODULE: WorkspaceModuleDefinition = {
  id: "projects",
  enabledByDefault: true,
  surface: {
    id: "projects",
    title: "Projects",
    description: "Project context",
    icon: <ProjectsIcon />,
    Component: ProjectsSurface,
    navGroups: PROJECTS_NAV_GROUPS,
    defaultNavItemId: PROJECTS_DEFAULT_NAV_ITEM_ID,
  },
  dashboardActions: [
    {
      id: "projects:open",
      description: "Active projects",
      label: "Projects",
      navItemId: PROJECTS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "projects",
    },
  ],
  commandActions: [
    {
      id: "quick:projects",
      hint: "Active",
      keywords: "projects project planning context next actions work active paused",
      label: "Open Projects",
      navItemId: PROJECTS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "projects",
    },
  ],
};
