import { lazy } from "react";

import { CalendarIcon } from "../../surfaces/icons";
import type { WorkspaceModuleDefinition } from "../types";

const CalendarSurface = lazy(() =>
  import("../../surfaces/calendar/CalendarSurface").then((module) => ({
    default: module.CalendarSurface,
  })),
);

export const CALENDAR_MODULE: WorkspaceModuleDefinition = {
  id: "calendar",
  enabledByDefault: true,
  surface: {
    id: "calendar",
    title: "Calendar",
    description: "Events",
    icon: <CalendarIcon />,
    Component: CalendarSurface,
  },
  dashboardActions: [
    {
      id: "calendar:open",
      description: "Events",
      label: "Calendar",
      surfaceId: "calendar",
    },
  ],
};
